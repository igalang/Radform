# Radform

**Radform** es una aplicación web educativa de radiología para estudiantes de Medicina, opositores MIR y residentes. Combina casos clínicos con imagen, entrenamiento por sesiones, preguntas radiológicas, MIR comentado y fuentes abiertas de imagen médica.

**Web:** https://igalang.github.io/Radform/

## Contenido

- **260 casos educativos originales** de radiografía, TC, RM, ecografía y mamografía, con viñeta clínica, cuatro opciones, explicación, diagnóstico diferencial y puntos docentes.
- Hotspot visual en los casos que disponen de una localización curada del hallazgo; el resto puede resolver una imagen abierta al abrir el caso.
- Entrenamientos aleatorios de hasta 10 casos con puntuación y revisión de errores.
- **180 preguntas originales** de radiología tipo MIR, 86 vinculadas a un caso con imagen.
- **MIR real · CasiMedicos/HiTZ:** preguntas MIR comentadas del dataset abierto CC BY 4.0.
- **Biblioteca resiliente:** el banco local carga inmediatamente y puede ampliarse con VQA-RAD. ROCOv2 y MultiCaRe se enlazan como grandes colecciones externas sin bloquear la aplicación.
- **VQA-RAD:** dataset CC0 de preguntas y respuestas visuales sobre imágenes radiológicas; GitHub Actions intenta preparar una copia local durante el despliegue.
- **ROCOv2:** colección externa de 79.789 imágenes radiológicas con pies de figura; Radform la enlaza, pero no re-hospeda sus imágenes.
- **MultiCaRe:** gran colección externa de imágenes/casos derivados de PubMed Central Open Access, enlazada desde Radform sin re-hospedar sus imágenes.
- **Atlas abierto:** 203 rutas temáticas y búsqueda libre en Wikimedia Commons y Open-i (NLM).
- Modo invitado con favoritos y progreso local; cuenta opcional con Supabase para sincronizar primeros intentos, puntos, estadísticas y participar en la clasificación.
- Ranking semanal, mensual y global con 10/20/30 puntos según dificultad y solo primer intento puntuable.
- PWA instalable, diseño responsive y tarjeta Open Graph para compartir.

## Biblioteca sin dependencia única

La pestaña **Biblioteca** abre por defecto el banco local de Radform. No espera a ninguna API externa. El usuario puede seleccionar otras fuentes:

1. **Radform** — 260 casos originales, siempre disponibles.
2. **VQA-RAD** — CC0 1.0; durante el despliegue se intenta descargar una copia local de sus 314 imágenes y más de 2.200 preguntas/respuestas.

ROCOv2 y MultiCaRe aparecen como **colecciones externas enlazadas**. Radform no re-hospeda sus imágenes para evitar mezclar en el mismo artefacto contenidos con términos CC BY-NC/CC BY-NC-SA o licencias por artículo variables.

El script `scripts/build_open_radiology_bundles.py` usa la API pública Dataset Viewer de Hugging Face durante GitHub Actions para preparar VQA-RAD. **No se necesita API key ni secreto.**

## Fuentes abiertas

### Wikimedia Commons

Se utiliza la MediaWiki Action API. Cada archivo conserva su propia licencia; Radform muestra autoría/licencia/fuente cuando la API las facilita.

### VQA-RAD

- Dataset: https://huggingface.co/datasets/abhay2812/vqa-rad
- Licencia declarada: CC0 1.0 Universal.
- Artículo: Lau JJ et al. *Scientific Data* 2018.

### ROCOv2

- Dataset: https://huggingface.co/datasets/eltorio/ROCOv2-radiology
- 79.789 imágenes radiológicas.
- Licencia del dataset: CC BY-NC-SA 4.0.

### MultiCaRe

- Dataset: https://huggingface.co/datasets/OpenMed/multicare-case-images
- Zenodo actual: https://zenodo.org/records/20416562
- La versión actual del dataset se declara CC BY-NC-SA 4.0; los elementos individuales pueden conservar licencias distintas. Radform no presupone una licencia uniforme.

### Open-i (NLM)

Radform puede buscar en Open-i. Los derechos de reutilización dependen del artículo/colección de origen y deben revisarse individualmente.

### CasiMedicos / HiTZ

- Dataset: https://huggingface.co/datasets/HiTZ/casimedicos-exp
- Licencia: CC BY 4.0.

Consulta [`ATTRIBUTIONS.md`](./ATTRIBUTIONS.md) para la política de atribución detallada.


## Cuentas, puntos y Supabase

Radform funciona sin registro. La cuenta es opcional y añade sincronización de primeros intentos, estadísticas y leaderboard.

Backend configurado:

- Supabase Project URL: `https://lcpeibwnigyuudmmpetp.supabase.co`
- El frontend utiliza una **publishable key** en `supabase-client.js`. Esta clave puede estar en código cliente; la seguridad se aplica con RLS.
- Tablas esperadas: `profiles`, `case_attempts`, `mir_attempts`.
- RPC esperadas: `get_my_stats()` y `get_leaderboard(text, integer)`.
- Puntuación: básico 10, intermedio 20, avanzado 30; solo el primer intento puede puntuar.
- Email y UUID no se muestran en el ranking. La visibilidad pública se controla desde `profiles.is_public`.

En **Supabase → Authentication → URL Configuration** debe mantenerse:

- Site URL: `https://igalang.github.io/Radform/`
- Redirect URL: `https://igalang.github.io/Radform/**`

La clasificación actual es educativa, no un sistema antifraude de competición. Al tratarse de una app estática, las respuestas correctas forman parte de los recursos enviados al navegador. Si en el futuro se organizan competiciones con premios o relevancia real, la validación de respuestas debería trasladarse a una Edge Function o a lógica de servidor que no exponga las claves de corrección.

## Instalación PWA

La propia aplicación incluye un panel **Instalar app** con instrucciones adaptadas a iPhone/iPad, Android y escritorio.

- **iPhone/iPad:** Safari → Compartir → Añadir a pantalla de inicio.
- **Android:** Chrome → menú ⋮ → Instalar aplicación / Añadir a pantalla de inicio.
- **Escritorio:** Chrome/Edge → icono de instalación o menú → Instalar Radform.

## Estructura

```text
Radform/
├── .github/workflows/deploy-pages.yml
├── assets/
│   ├── icons/
│   └── logo.svg
├── data/
│   ├── atlas-topics.json
│   ├── cases.json
│   ├── mir-questions.json
│   ├── mir-open-snapshot.json
│   ├── multicare-snapshot.json
│   ├── openi-snapshot.json
│   ├── roco-snapshot.json
│   └── vqa-rad-snapshot.json
├── scripts/
│   ├── build_mir_open_snapshot.py
│   ├── build_open_radiology_bundles.py
│   ├── build_openi_snapshot.py
│   ├── validate_atlas.py
│   ├── validate_cases.py
│   └── validate_mir.py
├── 404.html
├── app.js
├── supabase-client.js
├── commons.js
├── mir-open.js
├── multicare.js
├── openi.js
├── styles.css
├── index.html
├── manifest.webmanifest
├── sw.js
├── og.png
├── ATTRIBUTIONS.md
└── LICENSE
```

`generated/` se crea durante el workflow de GitHub Pages y se incluye únicamente en el artefacto publicado; no es necesario versionarlo.

## Ejecutar en local

```bash
python3 -m http.server 8080
```

Después abre `http://localhost:8080/`.

## Publicar con GitHub Pages

1. Sube todo el contenido del repositorio, incluidos `.github`, `.nojekyll` y `.gitignore`.
2. Ve a **Settings → Pages**.
3. En **Build and deployment → Source**, selecciona **GitHub Actions**.
4. El workflow `Build and deploy Radform to GitHub Pages` se ejecutará con cada `push` a `main`.

No se necesita ningún secreto para las fuentes abiertas. La integración de cuentas utiliza únicamente la **Project URL** y una **Supabase publishable key** en `supabase-client.js`; la autorización de datos se aplica mediante Row Level Security (RLS). Nunca debe incluirse una `service_role`/secret key ni la contraseña de la base de datos en el repositorio.

## Privacidad y uso educativo

Radform no solicita datos de pacientes y no deben introducirse datos identificativos de pacientes. Sin cuenta, el progreso y los favoritos se guardan en `localStorage`. Si el usuario crea una cuenta opcional, Supabase gestiona la autenticación y Radform sincroniza alias/perfil, primeros intentos, puntuación y estadísticas. El email no se publica en el leaderboard y el usuario puede excluir su perfil de la clasificación pública.

Radform es una herramienta educativa. No es un dispositivo médico y no debe utilizarse para tomar decisiones diagnósticas o terapéuticas sobre pacientes reales.

## Autora y contacto

**Itxaso Galán González, MD, EBIR**  
Interventional & Vascular Radiologist  
GitHub: [@igalang](https://github.com/igalang)  
Contacto: [itxa.galan@gmail.com](mailto:itxa.galan@gmail.com)

## Licencia

Código y contenido educativo original: **MIT License**. Imágenes, datasets, preguntas y contenidos externos: según su fuente y licencia específica. Consulta [`ATTRIBUTIONS.md`](./ATTRIBUTIONS.md).
