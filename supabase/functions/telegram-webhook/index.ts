import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const update = await req.json();

    console.log("Received Telegram update:", JSON.stringify(update, null, 2));

    // Handle callback query (inline button clicks)
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const data = callbackQuery.data;
      const [action, threadId] = data.split(':');
      
      console.log("Processing callback:", action, "for thread:", threadId);
      
      // Answer callback to remove loading state
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQuery.id }),
      });
      
      const topicId = callbackQuery.message?.message_thread_id;
      
      if (action === 'close') {
        await handleCloseCommand(supabase, botToken!, adminChatId!, threadId, topicId);
      } else if (action === 'info') {
        await handleInfoCommand(supabase, botToken!, adminChatId!, threadId, topicId);
      } else if (action === 'history') {
        await handleHistoryCommand(supabase, botToken!, adminChatId!, threadId, topicId);
      } else if (action === 'tpl') {
        // Template quick reply - threadId here is actually "threadId:templateKey"
        const parts = data.split(':');
        const tplThreadId = parts[1];
        const tplKey = parts[2];
        await handleTemplateReply(supabase, botToken!, adminChatId!, tplThreadId, topicId, tplKey);
      }
      
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const message = update.message;
    if (!message) {
      console.log("No message in update, ignoring");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle private messages (for auth)
    const chatId = message.chat?.id?.toString();
    const chatType = message.chat?.type;
    
    if (chatType === "private") {
      const text = message.text?.trim() || "";
      const userId = message.from?.id;
      const firstName = message.from?.first_name || "";
      const lastName = message.from?.last_name || "";
      const username = message.from?.username || "";
      
      // Handle /start command with auth token
      if (text.startsWith("/start auth_")) {
        const authToken = text.replace("/start auth_", "");
        console.log("Auth request from user:", userId, "token:", authToken);
        
        // Create or find user and generate magic link
        const telegramId = userId.toString();
        const fullName = [firstName, lastName].filter(Boolean).join(" ");
        const email = `telegram_${telegramId}@telegram.local`;
        
        // Check if user exists
        let userIdDb: string;
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("telegram_id", telegramId)
          .maybeSingle();
          
        if (existingProfile) {
          userIdDb = existingProfile.user_id;
          console.log("Existing user found:", userIdDb);
        } else {
          // Check if user with email exists
          const { data: existingUsers } = await supabase.auth.admin.listUsers();
          const existingUser = existingUsers?.users.find(u => u.email === email);
          
          if (existingUser) {
            userIdDb = existingUser.id;
            await supabase
              .from("profiles")
              .update({ telegram_id: telegramId, full_name: fullName })
              .eq("user_id", userIdDb);
          } else {
            // Create new user
            const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
              email,
              email_confirm: true,
              user_metadata: {
                full_name: fullName,
                telegram_id: telegramId,
              },
            });
            
            if (createError) {
              console.error("Error creating user:", createError);
              await sendPrivateMessage(botToken!, chatId, "❌ Ошибка авторизации. Попробуйте позже.");
              return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            
            userIdDb = newUser.user!.id;
            await supabase
              .from("profiles")
              .update({ telegram_id: telegramId })
              .eq("user_id", userIdDb);
          }
        }
        
        // Try to fetch and save Telegram avatar
        try {
          const avatarUrl = await fetchAndSaveTelegramAvatar(botToken!, supabase, supabaseUrl, userIdDb, userId);
          if (avatarUrl) {
            await supabase
              .from("profiles")
              .update({ avatar_url: avatarUrl })
              .eq("user_id", userIdDb);
            console.log("Avatar saved:", avatarUrl);
          }
        } catch (avatarError) {
          console.error("Error fetching avatar:", avatarError);
          // Continue without avatar
        }
        
        // Generate magic link with 15 minute expiry
        // Use deployed URL or preview URL
        const siteUrl = Deno.env.get("SITE_URL") || "https://an30.lovable.app";
        console.log("Generating magic link with site URL:", siteUrl);
        
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: {
            redirectTo: siteUrl + "/",
          },
        });
        
        if (linkError) {
          console.error("Error generating link:", linkError);
          await sendPrivateMessage(botToken!, chatId, "❌ Ошибка создания ссылки. Попробуйте позже.");
          return new Response(JSON.stringify({ ok: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        const magicLink = linkData.properties?.action_link;
        
        // Send magic link to user with better formatting
        await sendPrivateMessage(
          botToken!, 
          chatId, 
          `✅ *Авторизация успешна!*\n\n👋 Привет, ${fullName}!\n\n🔗 [Нажмите здесь для входа на сайт](${magicLink})\n\n⏱ _Ссылка действительна 15 минут_`
        );
        
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Handle regular /start or just /start without params
      if (text === "/start" || text.startsWith("/start")) {
        // Generate auth code and send it
        const telegramId = userId.toString();
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Delete old codes for this user
        await supabase
          .from("auth_codes")
          .delete()
          .eq("telegram_id", telegramId);
        
        // Save new code with username
        await supabase
          .from("auth_codes")
          .insert({
            telegram_id: telegramId,
            telegram_username: username || null,
            code,
            expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          });
        
        const usernameText = username ? `@${username}` : `ID: ${telegramId}`;
        
        await sendPrivateMessage(
          botToken!, 
          chatId, 
          `👋 Привет, ${firstName}!\n\n🔐 <b>Ваш код для входа:</b>\n\n<code>${code}</code>\n\n📱 <b>Ваш Telegram:</b> <code>${usernameText}</code>\n\n⏱ Код действителен 5 минут.\n\n👉 Введите <b>${usernameText}</b> и код на странице входа.`
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Handle /login command to get a new code
      if (text === "/login" || text === "/code") {
        const telegramId = userId.toString();
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Delete old codes
        await supabase
          .from("auth_codes")
          .delete()
          .eq("telegram_id", telegramId);
        
        // Save new code with username
        await supabase
          .from("auth_codes")
          .insert({
            telegram_id: telegramId,
            telegram_username: username || null,
            code,
            expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          });
        
        const usernameText = username ? `@${username}` : `ID: ${telegramId}`;
        
        await sendPrivateMessage(
          botToken!, 
          chatId, 
          `🔐 <b>Ваш новый код для входа:</b>\n\n<code>${code}</code>\n\n📱 <b>Ваш Telegram:</b> <code>${usernameText}</code>\n\n⏱ Код действителен 5 минут.`
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Handle /myid command
      if (text === "/myid" || text === "/id") {
        await sendPrivateMessage(
          botToken!, 
          chatId, 
          `📱 Ваш Telegram ID:\n\n<code>${userId}</code>\n\nСкопируйте его и вставьте на странице входа.`
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if message is from our admin chat
    if (chatId !== adminChatId) {
      console.log("Message not from admin chat, ignoring");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get topic ID from message
    const telegramTopicId = message.message_thread_id;
    if (!telegramTopicId) {
      // Message in general chat, check for general commands
      const text = message.text?.trim();
      if (text === "/help") {
        await sendTelegramMessage(botToken!, adminChatId!, 
          "📋 *Доступные команды:*\n\n" +
          "/help — Показать справку\n" +
          "/stats — Статистика чатов\n\n" +
          "*В топике чата:*\n" +
          "/close — Закрыть чат\n" +
          "/info — Информация о клиенте\n" +
          "/history — История сообщений\n" +
          "/templates — Быстрые ответы",
          null
        );
      } else if (text === "/stats") {
        const stats = await getChatStats(supabase);
        await sendTelegramMessage(botToken!, adminChatId!, stats, null);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Looking for chat thread by Telegram topic ID:", telegramTopicId);

    // Find the chat thread by Telegram topic ID
    const { data: mapping, error: mappingError } = await supabase
      .from('telegram_thread_mapping')
      .select('chat_thread_id')
      .eq('telegram_topic_id', telegramTopicId)
      .maybeSingle();

    if (mappingError || !mapping) {
      console.log("No mapping found for topic:", telegramTopicId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chatThreadId = mapping.chat_thread_id;
    console.log("Found chat thread:", chatThreadId);

    const text = message.text?.trim();
    
    // Handle commands
    if (text?.startsWith('/')) {
      const command = text.split(' ')[0].toLowerCase();
      
      if (command === '/close') {
        await handleCloseCommand(supabase, botToken!, adminChatId!, chatThreadId, telegramTopicId);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (command === '/info') {
        await handleInfoCommand(supabase, botToken!, adminChatId!, chatThreadId, telegramTopicId);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (command === '/history') {
        await handleHistoryCommand(supabase, botToken!, adminChatId!, chatThreadId, telegramTopicId);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (command === '/help') {
        await sendTelegramMessage(botToken!, adminChatId!,
          "📋 *Команды в топике:*\n\n" +
          "/close — Закрыть чат\n" +
          "/info — Информация о клиенте\n" +
          "/history — История сообщений\n" +
          "/templates — Быстрые ответы",
          telegramTopicId
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (command === '/templates') {
        await handleTemplatesCommand(botToken!, adminChatId!, chatThreadId, telegramTopicId);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Unknown command, don't process
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle photos from Telegram admin
    const photo = message.photo;
    let imageUrl: string | null = null;
    
    if (photo && photo.length > 0) {
      console.log("Processing photo from Telegram");
      
      // Get the largest photo (last in array)
      const largestPhoto = photo[photo.length - 1];
      const fileId = largestPhoto.file_id;
      
      try {
        // Get file path from Telegram
        const fileResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
        );
        const fileData = await fileResponse.json();
        
        if (fileData.ok && fileData.result?.file_path) {
          const filePath = fileData.result.file_path;
          
          // Download the photo
          const photoResponse = await fetch(
            `https://api.telegram.org/file/bot${botToken}/${filePath}`
          );
          const photoBuffer = await photoResponse.arrayBuffer();
          
          // Determine file extension
          const ext = filePath.split('.').pop() || 'jpg';
          const storagePath = `${chatThreadId}/${crypto.randomUUID()}.${ext}`;
          
          // Upload to Supabase Storage
          const { error: uploadError } = await supabase.storage
            .from('chat-images')
            .upload(storagePath, photoBuffer, {
              contentType: `image/${ext}`,
            });
          
          if (!uploadError) {
            // Get public URL
            const { data: urlData } = supabase.storage
              .from('chat-images')
              .getPublicUrl(storagePath);
            
            imageUrl = urlData?.publicUrl || null;
            console.log("Photo uploaded to storage:", imageUrl);
          } else {
            console.error("Error uploading photo:", uploadError);
          }
        }
      } catch (photoError) {
        console.error("Error processing photo:", photoError);
      }
    }

    const messageText = message.text?.trim();
    
    // If no text and no image, ignore
    if (!messageText && !imageUrl) {
      console.log("No text or image in message");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ignore messages from bots (including our own)
    if (message.from?.is_bot) {
      console.log("Message from bot, ignoring");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageContent = messageText || (imageUrl ? '📷 Фото' : '');
    console.log("Sending admin reply to thread:", chatThreadId, "Message:", messageContent, "Has image:", !!imageUrl);

    // Insert the admin's reply
    const { error: insertError } = await supabase
      .from('chat_messages')
      .insert({
        thread_id: chatThreadId,
        content: messageContent,
        sender: 'admin',
        metadata: { 
          from_telegram: true, 
          telegram_user: message.from?.username || message.from?.first_name,
          imageUrl: imageUrl,
        },
      });

    if (insertError) {
      console.error("Error inserting message:", insertError);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update thread status to active
    const { error: updateError } = await supabase
      .from('chat_threads')
      .update({ 
        status: 'active',
        last_message_at: new Date().toISOString(),
        waiting_since: null,
      })
      .eq('id', chatThreadId);

    if (updateError) {
      console.error("Error updating thread:", updateError);
    }

    // Notify client via Telegram if they have telegram_id
    try {
      const { data: thread } = await supabase
        .from('chat_threads')
        .select('user_id')
        .eq('id', chatThreadId)
        .single();

      if (thread?.user_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('telegram_id')
          .eq('user_id', thread.user_id)
          .single();

        if (profile?.telegram_id) {
          const siteUrl = Deno.env.get("SITE_URL") || "https://an30.lovable.app";
          const notifyText = `💬 *Новое сообщение от менеджера АН-30!*\n\n${messageContent.substring(0, 200)}`;
          const inlineKeyboard = {
            inline_keyboard: [[{ text: "💬 Открыть чат", url: `${siteUrl}/chat` }]],
          };
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: profile.telegram_id,
              text: notifyText,
              parse_mode: "Markdown",
              reply_markup: inlineKeyboard,
            }),
          });
        }
      }
    } catch (notifyError) {
      console.error("Error notifying client via TG:", notifyError);
    }

    console.log("Successfully sent reply from Telegram");

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in telegram-webhook:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function sendTelegramMessage(botToken: string, chatId: string, text: string, topicId: number | null) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown",
  };
  if (topicId) {
    body.message_thread_id = topicId;
  }
  
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendPrivateMessage(botToken: string, chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCloseCommand(supabase: any, botToken: string, chatId: string, threadId: string, topicId: number) {
  // Check if already closed
  const { data: thread } = await supabase
    .from('chat_threads')
    .select('status')
    .eq('id', threadId)
    .single();
    
  if (thread?.status === 'closed') {
    await sendTelegramMessage(botToken, chatId, "ℹ️ Чат уже закрыт", topicId);
    return;
  }

  const { error } = await supabase
    .from('chat_threads')
    .update({ status: 'closed' })
    .eq('id', threadId);

  if (error) {
    await sendTelegramMessage(botToken, chatId, "❌ Ошибка при закрытии чата", topicId);
    return;
  }

  await supabase
    .from('chat_messages')
    .insert({
      thread_id: threadId,
      content: 'Чат закрыт оператором',
      sender: 'system',
    });

  await sendTelegramMessage(botToken, chatId, "✅ Чат закрыт", topicId);
  
  await fetch(`https://api.telegram.org/bot${botToken}/closeForumTopic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_thread_id: topicId,
    }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInfoCommand(supabase: any, botToken: string, chatId: string, threadId: string, topicId: number) {
  const { data: thread } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('id', threadId)
    .single();

  if (!thread) {
    await sendTelegramMessage(botToken, chatId, "❌ Чат не найден", topicId);
    return;
  }

  let clientInfo = "👤 *Информация о клиенте:*\n\n";
  
  if (thread.user_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', thread.user_id)
      .single();

    if (profile) {
      clientInfo += `🏷 *Тип:* Зарегистрированный\n`;
      clientInfo += `👤 *Имя:* ${profile.full_name || 'Не указано'}\n`;
      clientInfo += `📧 *Email:* ${profile.email || 'Не указан'}\n`;
      clientInfo += `📱 *Телефон:* ${profile.phone || 'Не указан'}\n`;
      clientInfo += `📍 *Адрес:* ${profile.address || 'Не указан'}\n`;
    }
  } else if (thread.guest_session_id) {
    const { data: guestContact } = await supabase
      .from('guest_contacts')
      .select('*')
      .eq('thread_id', threadId)
      .maybeSingle();

    clientInfo += `🏷 *Тип:* Гость\n`;
    if (guestContact) {
      clientInfo += `👤 *Имя:* ${guestContact.name || 'Не указано'}\n`;
      clientInfo += `📧 *Email:* ${guestContact.email || 'Не указан'}\n`;
      clientInfo += `📱 *Телефон:* ${guestContact.phone || 'Не указан'}\n`;
    } else {
      clientInfo += `_Контактные данные не оставлены_\n`;
    }
    clientInfo += `🔑 *Сессия:* \`${thread.guest_session_id.substring(0, 8)}...\`\n`;
  }

  // Online/offline status
  const isOnline = thread.user_typing_at && 
    (new Date().getTime() - new Date(thread.user_typing_at).getTime()) < 5 * 60 * 1000;
  const lastActivity = thread.last_message_at ? new Date(thread.last_message_at) : null;
  const lastTyping = thread.user_typing_at ? new Date(thread.user_typing_at) : null;
  const latestActivity = lastTyping && lastActivity 
    ? (lastTyping > lastActivity ? lastTyping : lastActivity) 
    : lastActivity || lastTyping;
  
  clientInfo += `\n🌐 *Статус:* ${isOnline ? '🟢 Онлайн' : '🔴 Офлайн'}\n`;
  if (!isOnline && latestActivity) {
    clientInfo += `⏱ *Последняя активность:* ${latestActivity.toLocaleString('ru-RU', { timeZone: 'Asia/Chita' })}\n`;
  }

  const { count: messageCount } = await supabase
    .from('chat_messages')
    .select('*', { count: 'exact', head: true })
    .eq('thread_id', threadId);

  clientInfo += `\n📊 *Статистика чата:*\n`;
  clientInfo += `💬 *Сообщений:* ${messageCount || 0}\n`;
  clientInfo += `📅 *Создан:* ${new Date(thread.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Chita' })}\n`;
  clientInfo += `📌 *Статус:* ${getStatusText(thread.status)}\n`;

  await sendTelegramMessage(botToken, chatId, clientInfo, topicId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleHistoryCommand(supabase: any, botToken: string, chatId: string, threadId: string, topicId: number) {
  const { data: messages } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(20);

  if (!messages || messages.length === 0) {
    await sendTelegramMessage(botToken, chatId, "📭 Нет сообщений", topicId);
    return;
  }

  let history = "📜 *Последние сообщения:*\n\n";
  
  for (const msg of messages) {
    const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const sender = msg.sender === 'user' ? '👤' : msg.sender === 'admin' ? '👨‍💼' : '🤖';
    const content = msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content;
    history += `${sender} _${time}_ ${content}\n`;
  }

  await sendTelegramMessage(botToken, chatId, history, topicId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getChatStats(supabase: any): Promise<string> {
  const { count: totalChats } = await supabase
    .from('chat_threads')
    .select('*', { count: 'exact', head: true });

  const { count: activeChats } = await supabase
    .from('chat_threads')
    .select('*', { count: 'exact', head: true })
    .in('status', ['new', 'active', 'in_progress', 'waiting']);

  const { count: closedToday } = await supabase
    .from('chat_threads')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'closed')
    .gte('last_message_at', new Date().toISOString().split('T')[0]);

  const { count: newChats } = await supabase
    .from('chat_threads')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'new');

  return `📊 *Статистика чатов:*\n\n` +
    `📬 *Всего чатов:* ${totalChats || 0}\n` +
    `🟢 *Активных:* ${activeChats || 0}\n` +
    `🆕 *Новых:* ${newChats || 0}\n` +
    `✅ *Закрыто сегодня:* ${closedToday || 0}`;
}


function getStatusText(status: string): string {
  const statuses: Record<string, string> = {
    'new': '🆕 Новый',
    'active': '🟢 Активный',
    'in_progress': '💬 В работе',
    'waiting': '⏳ Ожидает',
    'closed': '✅ Закрыт',
  };
  return statuses[status] || status;
}

// Fetch user's Telegram avatar and save to storage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAndSaveTelegramAvatar(
  botToken: string, 
  supabase: any, 
  supabaseUrl: string,
  userIdDb: string, 
  telegramUserId: number
): Promise<string | null> {
  try {
    // Get user profile photos from Telegram
    const photosResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${telegramUserId}&limit=1`
    );
    const photosData = await photosResponse.json();
    
    if (!photosData.ok || !photosData.result?.photos?.length) {
      console.log("No profile photos found for user:", telegramUserId);
      return null;
    }
    
    // Get the largest photo (last in array)
    const photo = photosData.result.photos[0];
    const largestPhoto = photo[photo.length - 1];
    const fileId = largestPhoto.file_id;
    
    // Get file path from Telegram
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    const fileData = await fileResponse.json();
    
    if (!fileData.ok || !fileData.result?.file_path) {
      console.log("Could not get file path for photo");
      return null;
    }
    
    const filePath = fileData.result.file_path;
    
    // Download the photo
    const photoResponse = await fetch(
      `https://api.telegram.org/file/bot${botToken}/${filePath}`
    );
    const photoBuffer = await photoResponse.arrayBuffer();
    
    // Determine file extension
    const ext = filePath.split('.').pop() || 'jpg';
    const storagePath = `${userIdDb}/avatar.${ext}`;
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(storagePath, photoBuffer, {
        contentType: `image/${ext}`,
        upsert: true,
      });
    
    if (uploadError) {
      console.error("Error uploading avatar:", uploadError);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(storagePath);
    
    return urlData?.publicUrl || null;
  } catch (error) {
    console.error("Error in fetchAndSaveTelegramAvatar:", error);
    return null;
  }
}

const QUICK_TEMPLATES: Record<string, { label: string; emoji: string; text: string }> = {
  greet: { label: "Приветствие", emoji: "👋", text: "Здравствуйте! Меня зовут менеджер АН-30. Чем могу помочь?" },
  avail: { label: "Наличие", emoji: "📦", text: "Уточните, пожалуйста, марку и модель автомобиля, чтобы я проверил наличие." },
  price: { label: "Цена", emoji: "💰", text: "Стоимость данной детали — [укажите цену] ₽. Оформить заказ?" },
  delivery: { label: "Доставка", emoji: "🚚", text: "Доставка по городу — бесплатно при заказе от 3000 ₽. Срок доставки 1-2 дня." },
  order: { label: "Заказ оформлен", emoji: "✅", text: "Ваш заказ оформлен! Мы свяжемся с вами для подтверждения. Спасибо!" },
  wait: { label: "Подождите", emoji: "⏳", text: "Минутку, уточняю информацию. Скоро вернусь с ответом!" },
  vin: { label: "Запрос VIN", emoji: "🔍", text: "Подскажите VIN-номер вашего автомобиля, чтобы подобрать точную деталь." },
  thanks: { label: "Благодарность", emoji: "🙏", text: "Спасибо за обращение! Если будут вопросы — пишите, всегда рады помочь!" },
};

async function handleTemplatesCommand(botToken: string, chatId: string, threadId: string, topicId: number) {
  const keyboard = Object.entries(QUICK_TEMPLATES).map(([key, tpl]) => 
    [{ text: `${tpl.emoji} ${tpl.label}`, callback_data: `tpl:${threadId}:${key}` }]
  );

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: "⚡ *Быстрые ответы:*\nНажмите кнопку, чтобы отправить шаблон клиенту:",
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  };
  if (topicId) body.message_thread_id = topicId;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleTemplateReply(supabase: any, botToken: string, chatId: string, threadId: string, topicId: number, templateKey: string) {
  const tpl = QUICK_TEMPLATES[templateKey];
  if (!tpl) {
    await sendTelegramMessage(botToken, chatId, "❌ Шаблон не найден", topicId);
    return;
  }

  // Insert the template message as admin reply
  const { error } = await supabase
    .from('chat_messages')
    .insert({
      thread_id: threadId,
      content: tpl.text,
      sender: 'admin',
      metadata: { from_telegram: true, template: templateKey },
    });

  if (error) {
    await sendTelegramMessage(botToken, chatId, "❌ Ошибка отправки", topicId);
    return;
  }

  // Update thread status
  await supabase
    .from('chat_threads')
    .update({ 
      status: 'active',
      last_message_at: new Date().toISOString(),
      waiting_since: null,
    })
    .eq('id', threadId);

  // Notify client via Telegram
  try {
    const { data: thread } = await supabase
      .from('chat_threads')
      .select('user_id')
      .eq('id', threadId)
      .single();

    if (thread?.user_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_id')
        .eq('user_id', thread.user_id)
        .single();

      if (profile?.telegram_id) {
        const siteUrl = Deno.env.get("SITE_URL") || "https://an30.lovable.app";
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: profile.telegram_id,
            text: `💬 *Новое сообщение от менеджера АН-30!*\n\n${tpl.text.substring(0, 200)}`,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[{ text: "💬 Открыть чат", url: `${siteUrl}/chat` }]] },
          }),
        });
      }
    }
  } catch (e) {
    console.error("Error notifying client:", e);
  }

  await sendTelegramMessage(botToken, chatId, `✅ Отправлено: ${tpl.emoji} ${tpl.label}`, topicId);
}
