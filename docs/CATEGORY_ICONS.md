# Иконки категорий каталога

Документ описывает единый визуальный стиль иконок для плиток категорий на
главной и промт для их генерации.

## Почему логотип не ставится на иконку

Владелец просил «с нашим логотипом». Ставить логотип на каждую из двенадцати
иконок не следует, и вот причины:

- при размере плитки около 120 px логотип превращается в нечитаемое пятно и
  только загрязняет силуэт товара;
- повторённый двенадцать раз на одном экране знак перестаёт работать как знак;
- ни один крупный магазин запчастей так не делает: у Rossko, Autotrade и Berg
  на плитках чистый рендер товара, а бренд живёт в шапке и подвале.

Вместо этого единство достигается **общим стилем**: одинаковый ракурс, свет,
палитра и тень. Набор читается как один комплект, а фирменным его делает
сине-жёлтая палитра АН-30, а не наклейка логотипа.

## Технические требования

| Параметр | Значение |
| --- | --- |
| Формат | PNG с прозрачностью, затем конвертация в WebP |
| Размер | 512×512, отображается на 120–160 px |
| Вес | до 40 КБ после конвертации |
| Фон | прозрачный, плитка сама даёт подложку |
| Каталог | `apps/web/public/categories/<slug>.webp` |

Слаги должны совпадать со значениями в плитках категорий.

## Палитра

- Основной синий: `#0f2d66`
- Светлый синий: `#173ea5`
- Жёлтый акцент: `#f5c400`, только как небольшая деталь
- Металл: холодный серый `#c8d0dd` … `#8b95a6`
- Тень: мягкая, холодная, `rgb(16 30 60 / 12%)`

## Промт

Один и тот же промт для всех иконок, меняется только предмет. Английский —
генераторы на нём точнее.

```
Product icon of a {PREDMET}, isolated on a fully transparent background.

Style: clean three-quarter top-down product render, single soft studio light
from the upper left, gentle contact shadow beneath the object, no reflections
on the floor. Semi-realistic, slightly simplified geometry with smooth
surfaces and softly rounded edges. Crisp silhouette, no motion blur.

Colour: cool metallic greys (#c8d0dd to #8b95a6) for metal parts, deep blue
(#0f2d66) and mid blue (#173ea5) for plastic or painted parts, one small
yellow (#f5c400) accent detail only where the real part would plausibly have
one. No other hues.

Composition: object centred, occupying about 78 percent of the frame, equal
margins, level horizon, consistent camera angle and distance across the set.

Do not include: any text, any logo, any brand name, any label with letters,
watermarks, packaging, hands, background scenery, gradients behind the object,
drop shadows on a coloured backdrop, lens flare, neon, purple or violet tints.

Square 1:1, 512x512, transparent PNG.
```

### Предметы по категориям

| Слаг | `{PREDMET}` |
| --- | --- |
| `motornye-masla` | plastic engine oil canister, 4 litre, blue body with yellow cap |
| `shchetki` | pair of car windscreen wiper blades, side by side |
| `akkumulyatory` | car battery, dark blue case, grey terminals |
| `avtolampy` | halogen car headlight bulb H4 with glass envelope |
| `transmissionnye-masla` | one litre transmission fluid bottle, blue label area left blank |
| `antifriz` | five litre coolant canister, blue fluid visible |
| `avtohimiya` | aerosol spray can with a thin red applicator tube |
| `gidravlicheskaya-zhidkost` | rectangular metal fluid tin with a screw cap |
| `tehosmotr` | compact fire extinguisher, red body, black hose |
| `instrumenty` | pair of combination pliers with blue handles |
| `filtry` | cylindrical spin-on oil filter, blue housing |
| `tormoznaya-sistema` | vented brake disc with a pair of brake pads leaning on it |
| `shlangi-i-fitingi` | short coil of reinforced rubber hydraulic hose in deep blue with two crimped cool-grey metal fittings, next to one cool-grey metal elbow push-in tube fitting with a small yellow release collar (добавлена 22.11.2026 вместе с разделом, миграция 0049) |

## Проверка комплекта

Иконки принимаются только если весь набор проходит проверку:

1. Выложить все двенадцать в ряд на белом и на `#eef2f9`. Ракурс, масштаб и
   направление света должны совпадать; выбивающиеся перегенерировать.
2. Уменьшить до 120 px. Предмет должен оставаться узнаваемым.
3. Убедиться, что нигде не появились буквы или подобие логотипа — генераторы
   часто дорисовывают текст на этикетках сами.
4. Проверить, что фон действительно прозрачный, а не белый.


## Подразделы

Дерево разделов и подразделов описано один раз в
`packages/contracts/src/storefront-taxonomy.ts`. Поле `image` у подраздела —
имя файла в `apps/web/public/categories/`. Если своей картинки нет, плитка
показывает картинку родительского раздела.

Картинки подразделов генерируются тем же промтом, что и основной набор. К
каждому запросу прикладываются четыре готовые иконки (`filtry`,
`motornye-masla`, `tormoznaya-sistema`, `instrumenty`) как образец стиля.

### Как сгенерировать через Codex

```bash
codex exec --skip-git-repo-check -s workspace-write -C <папка> \
  -i apps/web/public/categories/filtry.webp -i apps/web/public/categories/motornye-masla.webp \
  -i apps/web/public/categories/tormoznaya-sistema.webp -i apps/web/public/categories/instrumenty.webp \
  - < prompt.txt
```

Промт передаётся через стандартный ввод: флаг `-i` принимает несколько файлов
и иначе заберёт текст как ещё одну картинку. В промте перечисляются имена
файлов и предметы, ниже — общий блок стиля из раздела «Промт» выше. Готовые
PNG переводятся в WebP 512×512 (качество 84) и кладутся в
`apps/web/public/categories/<slug>.webp`.

### Предметы подразделов

| Файл | `{PREDMET}` |
| --- | --- |
| `vozdushnye-filtry` | rectangular pleated panel car engine air filter with a dark blue rubber frame and light grey pleated media |
| `sinteticheskie-motornye-masla` | 4 litre plastic engine oil canister in deep blue with a yellow screw cap and a small yellow stripe across the blank label area |
| `polusinteticheskie-motornye-masla` | 4 litre plastic engine oil canister, two-tone: upper half deep blue, lower half light cool grey, blue screw cap |
| `mineralnye-motornye-masla` | 4 litre rectangular metal engine oil can in cool grey metal with a deep blue screw cap |
| `masla-dlya-moto-i-sadovoy-tekhniki` | small 1 litre engine oil bottle with a long pour spout standing next to a small motorcycle spark plug |
| `toplivnye-filtry` | cylindrical metal inline fuel filter with two short pipe nipples at each end, grey metal body with a deep blue band |
| `salonnye-filtry` | thin rectangular cabin air filter with light grey pleated media and a dark charcoal activated-carbon layer visible on top, deep blue thin frame |
| `tormoznye-kolodki` | pair of disc brake pads lying side by side, grey friction material on deep blue backing plates |
| `tormoznye-diski` | single vented brake disc with drilled holes, cool metallic grey, deep blue painted hub area |
| `tormoznye-barabany` | car rear brake drum, cast iron cool grey with a deep blue painted outer face and wheel bolt holes |
| `tormoznaya-zhidkost` | 500 ml plastic brake fluid bottle, deep blue with a yellow cap, label area left blank |
| `supporty-i-remkomplekty` | single floating brake caliper with one piston, deep blue painted body and grey metal bracket |
| `akkumulyatory-gruzovye` | large heavy truck battery, long dark blue case with two grey terminals and a carry handle on top |
| `akkumulyatory-moto` | small compact motorcycle battery, dark blue case with two small grey terminals |
| `zaryadnye-ustroystva` | compact car battery charger box in deep blue with a small display area left blank and two cables ending in grey crocodile clamps |
| `provoda-i-klemmy` | coiled pair of jump starter cables with large grey crocodile clamps, one cable deep blue and one cable yellow |
| `masla-dlya-mkpp` | 1 litre gear oil bottle with a pour spout, deep blue with a grey cap, next to a small grey metal gear wheel |
| `masla-dlya-akpp` | 1 litre automatic transmission fluid bottle, deep blue with a yellow cap, next to a small grey torque converter disc |
| `masla-dlya-variatora` | 1 litre transmission fluid bottle, deep blue with a grey cap, next to a short segment of grey steel push belt |
| `antifriz-kontsentrat` | 1.5 litre narrow concentrate coolant bottle with a measuring scale moulded in, deep blue body, yellow cap |
| `distillirovannaya-voda` | 5 litre translucent plastic water canister with clear water inside and a deep blue cap |
| `ksenonovye-lampy` | D2S xenon car headlight bulb with a white-grey ceramic base and a clear glass capsule |
| `svetodiodnye-lampy` | LED car headlight bulb with a finned metal heatsink, small cooling fan at the back, deep blue anodised body |
| `signalnye-lampy` | three small wedge and bayonet car signal bulbs grouped together, clear glass, grey metal bases |
| `shchetki-karkasnye` | conventional framed windscreen wiper blade with a cool grey metal frame and black rubber |
| `shchetki-gibridnye` | hybrid windscreen wiper blade with an aerodynamic deep blue plastic cover over the frame |
| `shchetki-zadnie` | short rear windscreen wiper arm with a short blade attached, deep blue arm |
| `zhidkosti-gur` | 1 litre power steering fluid bottle, deep blue with a yellow cap, next to a small grey power steering pump pulley |
| `dlya-kuzova-i-stekol` | trigger spray bottle of glass cleaner with light blue liquid next to a folded deep blue microfiber cloth |
| `dlya-salona` | aerosol foam cleaner can in deep blue next to a soft grey interior brush |
| `dlya-moyki` | car wash shampoo canister in deep blue next to a large light grey car wash sponge |
| `dlya-shin-i-diskov` | trigger spray bottle in deep blue leaning against a small grey alloy wheel rim |
| `zhidkost-omyvatelya` | 5 litre windscreen washer fluid canister with light blue fluid visible, deep blue cap |
| `prisadki` | small 300 ml fuel additive bottle with a long neck, deep blue with a yellow cap |
| `smazki` | metal grease tube and a small round tin of grease, cool grey metal with deep blue caps |
| `dlya-remonta` | tube of sealant and an aerosol rust converter can, deep blue and grey |
| `klyuchi-i-golovki` | combination spanner crossed with a ratchet handle and one socket, chrome cool grey with deep blue grip |
| `nabory-instrumentov` | open hard tool case in deep blue showing neatly arranged grey chrome sockets and a ratchet |
| `domkraty` | small hydraulic bottle jack in deep blue with a grey metal lifting saddle and handle |
| `semniki` | three-jaw gear puller, cool grey steel with a deep blue central screw handle |
| `diagnostika` | handheld digital multimeter in deep blue with a blank grey display and two test leads |
| `aptechki` | car first aid kit case, deep blue hard plastic box with a white cross symbol on the lid |
| `znaki-avariynoy-ostanovki` | folding warning triangle, red reflective frame on a grey metal stand |
| `zhilety-i-buksirnye-trosy` | folded high-visibility vest in yellow with grey reflective stripes next to a coiled deep blue tow rope with a grey metal hook |
