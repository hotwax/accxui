---
name: vue-composition-refactor
description: Convert Vue components from Options API to Composition API with script setup and standardized import organization.
---

# Vue Composition API Refactor Skill

This skill defines the process for refactoring Vue components from the Options API to the Composition API, specifically targeting projects using Ionic and TypeScript.

## Core Transformation Steps

### 1. Script Pattern Conversion
- Change `<script lang="ts">` to `<script setup lang="ts">`.
- Remove the boilerplate:
  - `defineComponent` wrapper.
  - `name` property.
  - `components` registration (not needed in `<script setup>`).
  - `computed` object (convert to individual `const x = computed(...)` calls).
  - `setup()` function and its `return` statement.

### 2. Import Standardization
- **Package Consolidation**: Ensure that imports from the same library are on a single line.
  - **Ionic**: `import { ... } from "@ionic/vue";`
  - **Icons**: `import { ... } from "ionicons/icons";`
- **Alphabetical Ordering**: Always sort named imports alphabetically within the brackets.

### 3. Dependency Management
- Use `useUserStore()` from Pinia/Vuex for store access.
- Use `useAuth()` or similar composables for authentication state.
- Use `router` from the local router configuration.

## Practical Example

### Input (Options API)
```vue
<script lang="ts">
import { IonItem, IonList } from "@ionic/vue";
import { pulseOutline, albumsOutline } from "ionicons/icons";
import { defineComponent, computed } from "vue";

export default defineComponent({
  components: { IonItem, IonList },
  computed: {
    isAuth() { return true; }
  },
  setup() {
    return { albumsOutline, pulseOutline };
  }
});
</script>
```

### Output (Composition API)
```vue
<script setup lang="ts">
import { IonItem, IonList } from "@ionic/vue";
import { computed } from "vue";
import { albumsOutline, pulseOutline } from "ionicons/icons";

const isAuth = computed(() => true);
</script>
```
