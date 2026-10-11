# Importing shared AccxUI functionality

New app code should import the module it uses rather than the `@common` entry or the `commonUtil` object. The compatibility entry remains supported for existing apps; it necessarily exposes a wider dependency graph and can retain component styles.

```ts
import { initialiseConfig } from '@common/core/configRegistry';
import { createDxpI18n, translate } from '@common/core/i18n';
import api from '@common/core/remoteApi';
import { isAppEmbedded, hasError } from '@common/utils/core';
import { formatDate, formatUtcDate } from '@common/utils/date';
import { getProductIdentificationValue } from '@common/utils/product';
```

CSV helpers and Japanese encoding live in `utils/csv`; cron helpers live in `utils/cron`. Neither belongs in a normal API/auth import chain. Date helpers import Luxon; product helpers do not. Helper implementations and the old compatibility object retain their synchronous/asynchronous signatures.

Import a Vue component directly, and defer routes or overlays until they are needed:

```ts
const route = {
  path: '/login',
  component: () => import('@common/components/Login.vue'),
};

// Inside the user's action, after any existing permission check:
const { default: ImageModal } = await import('@common/components/ImageModal.vue');
```

Do not globally disable module side effects to improve tree shaking: Vue styles and Ionic component registration can depend on them. Use production bundle reports to verify the actual entry graph; a smaller named entry alone does not prove that dependencies are deferred.

Receiving is the first app migrated to these imports. Other apps can migrate incrementally without changing the existing `@common` or `commonUtil` API.
