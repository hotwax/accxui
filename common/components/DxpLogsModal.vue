<template>
  <ion-header>
    <ion-toolbar>
      <ion-buttons slot="start">
        <ion-button :aria-label="translate('Close')" @click="closeModal()">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </ion-buttons>
      <ion-title>{{ translate("Logs") }}</ion-title>
      <ion-buttons slot="end">
        <ion-button :disabled="isBusy" @click="refresh()">
          <ion-icon slot="icon-only" :icon="refreshOutline" />
        </ion-button>
        <ion-button :disabled="isBusy || !records.length" @click="copyLogs()">
          <ion-icon slot="icon-only" :icon="copyOutline" />
        </ion-button>
        <ion-button :disabled="isBusy || !records.length" @click="confirmClear()">
          <ion-icon slot="icon-only" :icon="trashOutline" />
        </ion-button>
      </ion-buttons>
    </ion-toolbar>

    <ion-toolbar>
      <ion-segment v-model="activeLevel">
        <ion-segment-button value="all">
          <ion-label>{{ translate("All") }}</ion-label>
        </ion-segment-button>
        <ion-segment-button value="error">
          <ion-label>{{ translate("Errors") }}</ion-label>
        </ion-segment-button>
      </ion-segment>
    </ion-toolbar>
  </ion-header>

  <ion-content>
    <ion-list v-if="visibleRecords.length">
      <ion-item v-for="record in visibleRecords" :key="record.id" lines="full">
        <ion-label class="ion-text-wrap">
          <p class="meta">
            <ion-badge :color="colorFor(record.level)">
              {{ record.level }}
            </ion-badge>
            <span class="time">{{ formatTime(record.time) }}</span>
          </p>
          <p class="message">
            {{ record.message }}
          </p>
          <p v-if="record.caller" class="caller">
            {{ record.caller }}
          </p>
        </ion-label>
      </ion-item>
    </ion-list>

    <div v-else class="ion-text-center ion-padding">
      {{ isBusy ? translate("Loading...") : translate("No logs recorded yet.") }}
    </div>
  </ion-content>
</template>

<script setup lang="ts">
// Shows the log lines logStore kept on this device. Logs are only recorded when the app
// installs the logger with `persistLogs`; otherwise this opens on the empty state.
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
  alertController,
  modalController
} from "@ionic/vue";
import { closeOutline, copyOutline, refreshOutline, trashOutline } from "ionicons/icons";
import { computed, onMounted, ref } from "vue";
import { translate } from "../core/i18n";
import { type LogRecord, logStore } from "../core/logStore";
import { commonUtil } from "../utils/commonUtil";

const props = defineProps({
  // First line of the copied report, so a pasted log says which app it came from
  reportTitle: {
    type: String,
    default: "App logs"
  },
  // How many of the most recent entries to load
  limit: {
    type: Number,
    default: 500
  }
});

const records = ref<LogRecord[]>([]);
const isBusy = ref(false);
const activeLevel = ref("all");

const visibleRecords = computed(() => activeLevel.value === "error"
  ? records.value.filter((record) => record.level === "error")
  : records.value);

const colorFor = (level: string) => ({
  error: "danger",
  warn: "warning",
  info: "primary",
  debug: "medium",
  log: "medium"
} as Record<string, string>)[level] || "medium";

function formatTime(time: number) {
  try {
    return new Date(time).toLocaleString();
  } catch {
    return String(time);
  }
}

async function refresh() {
  isBusy.value = true;
  try {
    records.value = await logStore.readLogs(props.limit);
  } finally {
    isBusy.value = false;
  }
}

function buildReportText() {
  return [
    props.reportTitle,
    new Date().toISOString(),
    `${visibleRecords.value.length} entr${visibleRecords.value.length === 1 ? "y" : "ies"}`,
    ""
  ].concat(visibleRecords.value.map((record) =>
    `[${record.level.toUpperCase()}] ${formatTime(record.time)} ${record.message}${record.caller ? ` (${record.caller})` : ""}`)).join("\n");
}

async function copyLogs() {
  const text = buildReportText();

  try {
    await navigator.clipboard.writeText(text);
    commonUtil.showToast(translate("Logs copied to the clipboard."));
  } catch {
    // Clipboard needs a secure context and can be blocked, fall back to a selectable prompt
    // eslint-disable-next-line no-alert -- the one way left to hand the text over
    window.prompt(translate("Copy these logs"), text);
  }
}

async function confirmClear() {
  const alert = await alertController.create({
    header: translate("Clear logs"),
    message: translate("This removes every stored log entry on this device."),
    buttons: [
      { text: translate("Cancel"), role: "cancel" },
      {
        text: translate("Clear"),
        handler: async () => {
          await logStore.clearLogs();
          await refresh();
        }
      }
    ]
  });

  return alert.present();
}

function closeModal() {
  modalController.dismiss({ dismissed: true });
}

onMounted(refresh);
</script>

<style scoped>
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.time {
  font-size: 11px;
}

.message {
  font-family: monospace;
  font-size: 12px;
  word-break: break-word;
  white-space: pre-wrap;
}

.caller {
  font-size: 11px;
  opacity: 0.7;
}
</style>
