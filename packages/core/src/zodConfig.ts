// Imported FIRST by the browser apps (`import '@naqdpos/core/zod-config'`), before any schema is
// built. Zod 4 compiles object parsers with `new Function` and probes for it when a schema is
// created; under the apps' strict CSP (script-src 'self', deployment §4) that probe is reported as
// a violation even though zod falls back. jitless skips both the probe and the compiler.
import { z } from 'zod';

z.config({ jitless: true });
