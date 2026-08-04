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

## Проверка комплекта

Иконки принимаются только если весь набор проходит проверку:

1. Выложить все двенадцать в ряд на белом и на `#eef2f9`. Ракурс, масштаб и
   направление света должны совпадать; выбивающиеся перегенерировать.
2. Уменьшить до 120 px. Предмет должен оставаться узнаваемым.
3. Убедиться, что нигде не появились буквы или подобие логотипа — генераторы
   часто дорисовывают текст на этикетках сами.
4. Проверить, что фон действительно прозрачный, а не белый.
