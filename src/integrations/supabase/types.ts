export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      action_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      attendance_records: {
        Row: {
          checked_in_at: string | null
          checked_in_by: string | null
          created_at: string
          date: string
          employee_id: string
          id: string
          is_present: boolean
          note: string | null
          updated_at: string
        }
        Insert: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string
          date?: string
          employee_id: string
          id?: string
          is_present?: boolean
          note?: string | null
          updated_at?: string
        }
        Update: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          is_present?: boolean
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          telegram_id: string
          telegram_username: string | null
          used: boolean
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string
          id?: string
          telegram_id: string
          telegram_username?: string | null
          used?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          telegram_id?: string
          telegram_username?: string | null
          used?: boolean
        }
        Relationships: []
      }
      banners: {
        Row: {
          button_text: string | null
          created_at: string
          headline: string | null
          id: string
          image_desktop_url: string | null
          image_mobile_url: string | null
          is_active: boolean
          link_url: string | null
          schedule_from: string | null
          schedule_to: string | null
          sort_order: number
          subheadline: string | null
        }
        Insert: {
          button_text?: string | null
          created_at?: string
          headline?: string | null
          id?: string
          image_desktop_url?: string | null
          image_mobile_url?: string | null
          is_active?: boolean
          link_url?: string | null
          schedule_from?: string | null
          schedule_to?: string | null
          sort_order?: number
          subheadline?: string | null
        }
        Update: {
          button_text?: string | null
          created_at?: string
          headline?: string | null
          id?: string
          image_desktop_url?: string | null
          image_mobile_url?: string | null
          is_active?: boolean
          link_url?: string | null
          schedule_from?: string | null
          schedule_to?: string | null
          sort_order?: number
          subheadline?: string | null
        }
        Relationships: []
      }
      business_entities: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      cart_orders: {
        Row: {
          admin_notes: string | null
          created_at: string
          guest_email: string | null
          guest_name: string | null
          guest_phone: string
          id: string
          items: Json
          status: string
          total_amount: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          guest_email?: string | null
          guest_name?: string | null
          guest_phone: string
          id?: string
          items?: Json
          status?: string
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string
          id?: string
          items?: Json
          status?: string
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_enabled: boolean
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_enabled?: boolean
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_enabled?: boolean
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          delivered_at: string | null
          id: string
          is_read: boolean
          metadata: Json | null
          read_at: string | null
          sender: string
          thread_id: string
        }
        Insert: {
          content: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          is_read?: boolean
          metadata?: Json | null
          read_at?: string | null
          sender: string
          thread_id: string
        }
        Update: {
          content?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          is_read?: boolean
          metadata?: Json | null
          read_at?: string | null
          sender?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          admin_typing: boolean | null
          admin_typing_at: string | null
          created_at: string
          guest_session_id: string | null
          id: string
          last_message_at: string | null
          rating: number | null
          status: string
          user_id: string | null
          user_typing: boolean | null
          user_typing_at: string | null
          waiting_since: string | null
        }
        Insert: {
          admin_typing?: boolean | null
          admin_typing_at?: string | null
          created_at?: string
          guest_session_id?: string | null
          id?: string
          last_message_at?: string | null
          rating?: number | null
          status?: string
          user_id?: string | null
          user_typing?: boolean | null
          user_typing_at?: string | null
          waiting_since?: string | null
        }
        Update: {
          admin_typing?: boolean | null
          admin_typing_at?: string | null
          created_at?: string
          guest_session_id?: string | null
          id?: string
          last_message_at?: string | null
          rating?: number | null
          status?: string
          user_id?: string | null
          user_typing?: boolean | null
          user_typing_at?: string | null
          waiting_since?: string | null
        }
        Relationships: []
      }
      contact_requests: {
        Row: {
          admin_notes: string | null
          created_at: string
          email: string | null
          id: string
          message: string | null
          name: string | null
          phone: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          email?: string | null
          id?: string
          message?: string | null
          name?: string | null
          phone: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          email?: string | null
          id?: string
          message?: string | null
          name?: string | null
          phone?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_reports: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          report_date: string
          status: string
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          report_date?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          report_date?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          position: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          position?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          position?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      engine_parts: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          label: string
          sort_order: number
          updated_at: string
          x_position: number
          y_position: number
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          updated_at?: string
          x_position?: number
          y_position?: number
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
          x_position?: number
          y_position?: number
        }
        Relationships: []
      }
      exchange_files: {
        Row: {
          content: string
          created_at: string
          filename: string
          id: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          filename: string
          id?: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          filename?: string
          id?: string
          session_id?: string
        }
        Relationships: []
      }
      exchange_logs: {
        Row: {
          categories_created: number | null
          completed_at: string | null
          created_at: string
          error_details: Json | null
          errors_count: number | null
          exchange_type: string | null
          file_count: number | null
          id: string
          products_created: number | null
          products_updated: number | null
          session_id: string
          started_at: string
          status: string
          total_size_bytes: number | null
        }
        Insert: {
          categories_created?: number | null
          completed_at?: string | null
          created_at?: string
          error_details?: Json | null
          errors_count?: number | null
          exchange_type?: string | null
          file_count?: number | null
          id?: string
          products_created?: number | null
          products_updated?: number | null
          session_id: string
          started_at?: string
          status?: string
          total_size_bytes?: number | null
        }
        Update: {
          categories_created?: number | null
          completed_at?: string | null
          created_at?: string
          error_details?: Json | null
          errors_count?: number | null
          exchange_type?: string | null
          file_count?: number | null
          id?: string
          products_created?: number | null
          products_updated?: number | null
          session_id?: string
          started_at?: string
          status?: string
          total_size_bytes?: number | null
        }
        Relationships: []
      }
      guest_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string | null
          phone: string | null
          thread_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          thread_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_contacts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          guid_1c: string | null
          id: string
          invoice_id: string
          price: number
          product_id: string | null
          quantity: number
          sku: string | null
          title: string
          total: number
        }
        Insert: {
          created_at?: string
          guid_1c?: string | null
          id?: string
          invoice_id: string
          price?: number
          product_id?: string | null
          quantity?: number
          sku?: string | null
          title: string
          total?: number
        }
        Update: {
          created_at?: string
          guid_1c?: string | null
          id?: string
          invoice_id?: string
          price?: number
          product_id?: string | null
          quantity?: number
          sku?: string | null
          title?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          counterparty: string | null
          created_at: string
          created_by: string | null
          date: string
          export_session_id: string | null
          exported_at: string | null
          id: string
          notes: string | null
          number: string
          status: string
          total_amount: number
          type: string
          updated_at: string
        }
        Insert: {
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          export_session_id?: string | null
          exported_at?: string | null
          id?: string
          notes?: string | null
          number: string
          status?: string
          total_amount?: number
          type?: string
          updated_at?: string
        }
        Update: {
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          export_session_id?: string | null
          exported_at?: string | null
          id?: string
          notes?: string | null
          number?: string
          status?: string
          total_amount?: number
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      page_views: {
        Row: {
          id: string
          page_path: string
          session_id: string | null
          viewed_at: string
        }
        Insert: {
          id?: string
          page_path?: string
          session_id?: string | null
          viewed_at?: string
        }
        Update: {
          id?: string
          page_path?: string
          session_id?: string | null
          viewed_at?: string
        }
        Relationships: []
      }
      pages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          is_published: boolean
          seo_description: string | null
          seo_title: string | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_images: {
        Row: {
          created_at: string
          id: string
          product_id: string
          sort_order: number
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          sort_order?: number
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          sort_order?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          availability_status: string
          brand: string | null
          category_id: string | null
          created_at: string
          description: string | null
          display_title: string | null
          guid_1c: string | null
          id: string
          is_popular: boolean
          is_published: boolean
          old_price: number | null
          price: number
          props: Json | null
          sku: string | null
          stock_qty: number
          title: string
          updated_at: string
        }
        Insert: {
          availability_status?: string
          brand?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          display_title?: string | null
          guid_1c?: string | null
          id?: string
          is_popular?: boolean
          is_published?: boolean
          old_price?: number | null
          price?: number
          props?: Json | null
          sku?: string | null
          stock_qty?: number
          title: string
          updated_at?: string
        }
        Update: {
          availability_status?: string
          brand?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          display_title?: string | null
          guid_1c?: string | null
          id?: string
          is_popular?: boolean
          is_published?: boolean
          old_price?: number | null
          price?: number
          props?: Json | null
          sku?: string | null
          stock_qty?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_super_admin: boolean
          phone: string | null
          telegram_id: string | null
          updated_at: string
          user_id: string
          vk_id: string | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_super_admin?: boolean
          phone?: string | null
          telegram_id?: string | null
          updated_at?: string
          user_id: string
          vk_id?: string | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_super_admin?: boolean
          phone?: string | null
          telegram_id?: string | null
          updated_at?: string
          user_id?: string
          vk_id?: string | null
        }
        Relationships: []
      }
      report_categories: {
        Row: {
          created_at: string
          entity_id: string
          id: string
          is_active: boolean
          name: string
          sign: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          entity_id: string
          id?: string
          is_active?: boolean
          name: string
          sign?: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          entity_id?: string
          id?: string
          is_active?: boolean
          name?: string
          sign?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_categories_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      report_entries: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          id: string
          note: string | null
          report_id: string
        }
        Insert: {
          amount?: number
          category_id: string
          created_at?: string
          id?: string
          note?: string | null
          report_id: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          id?: string
          note?: string | null
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "report_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_entries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          report_id: string
          url: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          report_id: string
          url: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          report_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_photos_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          address: string | null
          chat_hours: Json
          chat_offline_autoreply: string | null
          created_at: string
          exchange_login: string | null
          exchange_password: string | null
          id: string
          no_item_text: string | null
          phone: string | null
          shop_hours: Json
          social_max: string | null
          social_telegram: string | null
          social_vk: string | null
          social_whatsapp: string | null
          telegram_nick: string | null
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          chat_hours?: Json
          chat_offline_autoreply?: string | null
          created_at?: string
          exchange_login?: string | null
          exchange_password?: string | null
          id?: string
          no_item_text?: string | null
          phone?: string | null
          shop_hours?: Json
          social_max?: string | null
          social_telegram?: string | null
          social_vk?: string | null
          social_whatsapp?: string | null
          telegram_nick?: string | null
          timezone?: string
          title?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          chat_hours?: Json
          chat_offline_autoreply?: string | null
          created_at?: string
          exchange_login?: string | null
          exchange_password?: string | null
          id?: string
          no_item_text?: string | null
          phone?: string | null
          shop_hours?: Json
          social_max?: string | null
          social_telegram?: string | null
          social_vk?: string | null
          social_whatsapp?: string | null
          telegram_nick?: string | null
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      telegram_thread_mapping: {
        Row: {
          chat_thread_id: string
          created_at: string
          id: string
          telegram_topic_id: number
        }
        Insert: {
          chat_thread_id: string
          created_at?: string
          id?: string
          telegram_topic_id: number
        }
        Update: {
          chat_thread_id?: string
          created_at?: string
          id?: string
          telegram_topic_id?: number
        }
        Relationships: []
      }
      user_favorites: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      user_product_views: {
        Row: {
          id: string
          product_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          id?: string
          product_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_product_views_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      store_settings_public: {
        Row: {
          address: string | null
          chat_hours: Json | null
          chat_offline_autoreply: string | null
          created_at: string | null
          id: string | null
          no_item_text: string | null
          phone: string | null
          shop_hours: Json | null
          social_max: string | null
          social_telegram: string | null
          social_vk: string | null
          social_whatsapp: string | null
          telegram_nick: string | null
          timezone: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          chat_hours?: Json | null
          chat_offline_autoreply?: string | null
          created_at?: string | null
          id?: string | null
          no_item_text?: string | null
          phone?: string | null
          shop_hours?: Json | null
          social_max?: string | null
          social_telegram?: string | null
          social_vk?: string | null
          social_whatsapp?: string | null
          telegram_nick?: string | null
          timezone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          chat_hours?: Json | null
          chat_offline_autoreply?: string | null
          created_at?: string | null
          id?: string | null
          no_item_text?: string | null
          phone?: string | null
          shop_hours?: Json | null
          social_max?: string | null
          social_telegram?: string | null
          social_vk?: string | null
          social_whatsapp?: string | null
          telegram_nick?: string | null
          timezone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_unread_count: {
        Args: { p_sender: string; p_thread_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_messages_as_read: {
        Args: { p_sender: string; p_thread_id: string }
        Returns: undefined
      }
      mark_messages_delivered: {
        Args: { p_sender: string; p_thread_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "user" | "director"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "user", "director"],
    },
  },
} as const
