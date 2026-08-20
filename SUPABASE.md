# Radform + Supabase

Radform conserva un modo invitado completamente funcional y utiliza Supabase únicamente para las funciones opcionales de cuenta, sincronización, puntuación y clasificación.

## Configuración de frontend

`supabase-client.js` contiene exclusivamente:

- Project URL pública.
- Publishable key pública.

No deben almacenarse en GitHub la contraseña de la base de datos, claves `service_role`, secret keys ni credenciales personales.

## Esquema esperado

Tablas:

- `public.profiles`
- `public.case_attempts`
- `public.mir_attempts`

Funciones RPC:

- `public.get_my_stats()`
- `public.get_leaderboard(p_period text, p_limit integer)`

RLS debe permanecer habilitado en las tres tablas.

## Modelo de privacidad

- El email se utiliza para autenticación y no se devuelve en el leaderboard.
- El ranking expone únicamente alias/nombre visible, puntos, precisión y número de primeros intentos de perfiles públicos.
- El usuario puede poner `is_public = false` desde la interfaz.
- Favoritos permanecen locales en esta versión.
- Los primeros intentos de casos y preguntas MIR se sincronizan con Supabase cuando hay sesión.

## Puntuación

- Básico: 10 puntos.
- Intermedio: 20 puntos.
- Avanzado: 30 puntos.
- Solo un primer intento correcto suma puntos.
- Los reintentos se conservan para aprendizaje, pero no añaden puntos.

## URLs de autenticación

Supabase → Authentication → URL Configuration:

- Site URL: `https://igalang.github.io/Radform/`
- Redirect URL: `https://igalang.github.io/Radform/**`

## Nota de integridad competitiva

El leaderboard es educativo. Como los bancos de preguntas y casos se sirven al navegador, no debe considerarse antifraude. Si se habilitan premios, competición formal o evaluación certificada, la comprobación de respuestas debe migrarse a una función de servidor/Edge Function con el answer key fuera del cliente.
