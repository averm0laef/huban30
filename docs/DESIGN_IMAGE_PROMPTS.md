# Design image provenance

## Parts selection editorial photograph

- **File:** `apps/web/public/editorial/parts-selection.webp`
- **Purpose:** Editorial illustration for the “Поможем подобрать запчасть” section. This is generated illustrative imagery, not a photograph of AN30 premises or proof of a specific product offering.
- **Method:** Built-in `image_gen` tool; one generation followed by a targeted removal of numerals from the measuring tool. No external stock imagery or named brands.
- **Created:** 2026-09-14.
- **Final dimensions:** 1000 × 667 pixels, WebP, 65,228 bytes.
- **Optimization:** Resized from 1536 × 1024 pixels and converted with Sharp, WebP quality 84, effort 6. No Python image editing.
- **Original generated source:** `/Users/antonermolaev/.codex/generated_images/01a09f84-aabb-7260-b4be-c8dadbe64645/exec-33d64519-cf0f-4b34-8171-a5507f782f9c.png` (not required by the website).

### Generation prompt

```text
Use case: photorealistic-natural.
Asset type: automotive parts website editorial photograph for the section 'Help choosing the right spare part'.
Primary request: a premium photorealistic editorial still life of mechanical inspection on a clean mechanic's workbench. Main subjects: one physically plausible metallic automotive brake disc with correctly concentric machined surfaces and five lug bolt holes, a single separate compact steel bearing, a ratchet socket wrench, and a stainless steel vernier caliper laid beside the part. The tools are resting on the table, not magically connected. A softly folded deep navy-blue shop towel sits partly beneath the components; one very small restrained yellow accent comes from a yellow-handled tool at the edge. No other clutter.
Scene/backdrop: dark matte navy workbench surface, refined but believable automotive workshop product photography. The tabletop fills the background, no workshop identity implied.
Composition/framing: landscape 3:2, approximately 1536 by 1024 pixels, tight intentional overhead / high three-quarter camera angle, balanced arrangement with all main objects recognizable in a compact website crop. Close enough to see tactile machined metal but the complete brake disc remains visible.
Lighting/mood: beautiful soft directional studio window light, natural soft shadows, quiet technical precision, no dramatic racing mood, no colored glow.
Color palette: cool silver steel, deep navy approximately #0f2d66, restrained yellow detail.
Materials/textures: realistic brushed steel, concentric machining on the brake disc, subtle towel fibers, realistic tool geometry, clean usable parts with a few natural texture details.
Constraints: no people, no hands, no car, no logos, no brands, no visible text, no letters, no numbers, no labels, no watermarks, no graphic overlays. Caliper and wrench unbranded, measuring marks can be faint simple ticks with no digits. No sparks or flashy lighting. High-quality real photographic look, not illustration or 3D rendering.
```

### Refinement prompt

```text
Use case: precise-object-edit. Edit this image only to remove every tiny numeral and letter from the caliper at lower right, leaving the fine engraved measurement tick marks without digits. No numbers and no letters anywhere on any tool. Keep every other part of the photograph exactly the same: composition, metal brake disc, five lug holes, bearing, navy towel, ratchet, yellow accent, lighting, crop and colors. Preserve realistic brushed stainless steel beneath the removed numerals. Landscape 3:2.
```

### Visual verification

The final image was visually inspected: intact brake disc, bearing and measuring tools; navy and silver palette with a small yellow accent; no people, branding or promotional text. The optimized asset preserves the same composition and is suitable for a responsive website image.
