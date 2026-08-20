# Fuentes, atribuciones y licencias

Radform combina contenido educativo original con fuentes externas abiertas. **No existe una licencia única aplicable a todo el material de terceros**: cada dataset, artículo o archivo conserva sus propios términos. Antes de reutilizar una imagen fuera de Radform debe revisarse siempre su ficha o artículo de origen.

## Banco de casos de Radform

El banco local contiene **260 casos educativos originales**. Las viñetas, preguntas, explicaciones, diagnósticos diferenciales y puntos docentes de esos casos son contenido educativo de Radform y no son preguntas oficiales del MIR.

- Los casos con imagen fija almacenan en `data/cases.json` la página original, autor/crédito y licencia.
- Los casos con imagen dinámica consultan Wikimedia Commons mediante un término radiológico; la app muestra la atribución y licencia devueltas por Commons cuando están disponibles.
- Una imagen alojada en Wikimedia Commons **no es necesariamente de dominio público**.

## Wikimedia Commons

Radform utiliza la MediaWiki Action API de Wikimedia Commons para localizar imágenes y metadatos. Commons contiene archivos con licencias distintas (CC BY, CC BY-SA, CC0, dominio público, etc.). Radform muestra, cuando la API los facilita, autor/crédito, licencia y enlace a la ficha original. La reutilización posterior debe cumplir la licencia concreta del archivo.

- Fuente: https://commons.wikimedia.org/
- API: https://www.mediawiki.org/wiki/API:Main_page

## VQA-RAD

VQA-RAD es un dataset de preguntas y respuestas visuales sobre imágenes radiológicas. La distribución utilizada por Radform declara **CC0 1.0 Universal**.

- Dataset: https://huggingface.co/datasets/abhay2812/vqa-rad
- Artículo original: Lau JJ, Gayen S, Ben Abacha A, Demner-Fushman D. *A dataset of clinically generated visual questions and answers about radiology images*. Scientific Data. 2018.
- Licencia declarada: https://creativecommons.org/publicdomain/zero/1.0/

Radform prepara durante el despliegue una copia local limitada de las imágenes/preguntas para evitar que el aprendizaje dependa de una API en vivo.

## ROCOv2

ROCOv2 contiene **79.789 imágenes radiológicas** con pies de figura y conceptos médicos extraídos del PMC Open Access Subset. El dataset se declara **CC BY-NC-SA 4.0**; los artículos fuente pueden tener CC BY o CC BY-NC.

- Dataset: https://huggingface.co/datasets/eltorio/ROCOv2-radiology
- Repositorio: https://github.com/sctg-development/ROCOv2-radiology
- Licencia del dataset: https://creativecommons.org/licenses/by-nc-sa/4.0/

Radform usa una muestra local generada durante el despliegue con finalidad educativa no comercial y conserva el enlace al dataset/fuente.

## MultiCaRe

MultiCaRe se construye a partir de case reports de PubMed Central Open Access. La ficha del dataset representativo en Hugging Face declara **CC BY 4.0**, mientras que la versión completa actual en Zenodo se declara **CC BY-NC-SA 4.0** y documenta licencias variables por elemento (por ejemplo CC BY, CC BY-NC, CC BY-NC-SA o CC0). Por prudencia, Radform **no re-hospeda** las imágenes de MultiCaRe y no atribuye una licencia uniforme a toda la colección.

- Dataset representativo: https://huggingface.co/datasets/OpenMed/multicare-case-images
- Registro Zenodo actual: https://zenodo.org/records/20416562
- Artículo descriptivo inicial: https://pmc.ncbi.nlm.nih.gov/articles/PMC10792687/
- Licencia del dataset actual: https://creativecommons.org/licenses/by-nc-sa/4.0/

Cuando está disponible, Radform muestra la licencia por elemento y/o enlaza al artículo PMC original.

## Open-i — U.S. National Library of Medicine

Open-i se utiliza como índice/buscador de imágenes biomédicas. Los derechos de cada imagen dependen del artículo o colección de origen; **Open-i no se trata como si otorgara una licencia global sobre todo lo indexado**.

- Fuente: https://openi.nlm.nih.gov/

Radform enlaza a la fuente original para comprobar los términos de cada elemento.

## MIR real — CasiMedicos / HiTZ

La subsección MIR real consulta `HiTZ/casimedicos-exp`, un conjunto de preguntas MIR comentadas y estructuradas publicado bajo **CC BY 4.0**.

- Dataset: https://huggingface.co/datasets/HiTZ/casimedicos-exp
- Código/datos del proyecto: https://github.com/ixa-ehu/antidote-casimedicos
- Licencia: https://creativecommons.org/licenses/by/4.0/

Radform conserva la atribución y el enlace a la fuente. No se presenta el contenido como material oficial del Ministerio de Sanidad.

## Privacidad, uso educativo y retirada de contenido

Radform es una herramienta de formación y autoevaluación. No es un producto sanitario, no proporciona diagnóstico médico y no debe utilizarse para tomar decisiones clínicas sobre pacientes reales. No deben introducirse datos identificativos de pacientes.

Si eres titular de derechos y detectas una atribución incorrecta, una licencia que haya cambiado o un contenido que deba retirarse, contacta con **itxa.galan@gmail.com** para revisión o retirada.

## Código y textos propios

El código original de Radform y los textos educativos originales se distribuyen según la licencia del repositorio. Los contenidos externos conservan siempre su licencia propia y no quedan relicenciados por Radform.
