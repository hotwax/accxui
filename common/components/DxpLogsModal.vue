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
        <ion-button :disabled="isBusy || !records.length" :aria-label="translate('Download logs')" :title="translate('Download logs')" @click="downloadLogs()">
          <ion-icon slot="icon-only" :icon="downloadOutline" />
        </ion-button>
        <ion-button color="danger" :disabled="isBusy || !records.length" @click="confirmClear()">
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

  <!-- The scroller owns scrolling, so ion-content does not scroll as well -->
  <ion-content :scroll-y="false">
    <!-- Only the rows on screen are rendered; each is measured after render since wrapped messages vary in height -->
    <DynamicScroller
      v-if="visibleRecords.length"
      :items="visibleRecords"
      key-field="id"
      :min-item-size="64"
      class="log-list"
    >
      <template #default="{ item: record, active }">
        <DynamicScrollerItem :item="record" :active="active" :size-dependencies="[record.message, record.caller]">
          <ion-item lines="full">
            <ion-label class="ion-text-wrap">
              <p class="meta">
                <ion-badge :color="colorFor(record.level)">
                  {{ record.level }}
                </ion-badge>
                <ion-badge v-if="record.oms" color="medium">
                  {{ record.oms }}
                </ion-badge>
                <ion-badge v-if="record.username" color="primary">
                  {{ record.username }}
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
        </DynamicScrollerItem>
      </template>
    </DynamicScroller>

    <div v-else class="ion-text-center ion-padding">
      {{ isBusy ? translate("Loading...") : translate("No logs recorded yet.") }}
    </div>
  </ion-content>
</template>

<script setup lang="ts">
import { IonBadge, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonSegment, IonSegmentButton, IonTitle, IonToolbar, alertController, modalController } from "@ionic/vue";
import { saveAs } from "file-saver";
import { closeOutline, copyOutline, downloadOutline, refreshOutline, trashOutline } from "ionicons/icons";
import { computed, onMounted, ref, shallowRef } from "vue";
import { DynamicScroller, DynamicScrollerItem } from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import { translate } from "../core/i18n";
import { type LogRecord, logStore } from "../core/logStore";
import { commonUtil } from "../utils/commonUtil";

const props = defineProps({
  limit: {
    type: Number,
    default: 500
  }
});

// Shallow: rows are read-only once loaded and the list is only ever replaced whole, so Vue
// tracks the array swap without wrapping every record in a reactive proxy
const records = shallowRef<LogRecord[]>([]);
const isBusy = ref(false);

// Which app and environment the logs came from, from VITE_APP_VERSION_CONFIG, which every app sets.
// A missing or malformed config gives empty values rather than breaking the modal.
function readVersionConfig() {
  try {
    const versionConfig = JSON.parse(import.meta.env.VITE_APP_VERSION_CONFIG || "{}");

    return { appId: String(versionConfig.appId || ""), environmentTypeId: String(versionConfig.environmentTypeId || "") };
  } catch {
    return { appId: "", environmentTypeId: "" };
  }
}

const { appId, environmentTypeId } = readVersionConfig();

const reportTitle = appId ? `${appId.replace(/_/g, " ")} logs` : "App logs";
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

function buildReportText(entries: LogRecord[]) {
  return [
    reportTitle,
    ...(environmentTypeId ? [`Environment: ${environmentTypeId}`] : []),
    formatTime(Date.now()),
    `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
    ""
  ].concat(entries.map((record) =>
    `[${record.level.toUpperCase()}] ${formatTime(record.time)}${record.oms ? ` [${record.oms}]` : ""}${record.username ? ` [${record.username}]` : ""} ${record.message}${record.caller ? ` (${record.caller})` : ""}`)).join("\n");
}


function downloadFileName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const name = reportTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "logs";

  return `${name}-${stamp}.txt`;
}

async function downloadLogs() {
  isBusy.value = true;
  try {
    const entries = await logStore.readAllLogs();
    if(!entries.length) {
      commonUtil.showToast(translate("No logs recorded yet."));

      return;
    }

    saveAs(new Blob([buildReportText(entries)], { type: "text/plain;charset=utf-8" }), downloadFileName());
  } catch {
    commonUtil.showToast(translate("Logs could not be downloaded."));
  } finally {
    isBusy.value = false;
  }
}

async function copyLogs() {
  const text = buildReportText(visibleRecords.value);

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
.log-list {
  height: 100%;
}

.meta {
  display: flex;
  flex-wrap: wrap;
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
