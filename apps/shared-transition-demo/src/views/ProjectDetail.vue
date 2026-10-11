<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/projects" />
        </ion-buttons>
        <ion-title>Project detail</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <template v-if="project">
        <ion-card>
          <ion-card-header>
            <ion-card-title
              v-shared-element="{ scope: 'project', id: project.id, part: 'summary', priority: 1 }"
              class="shared-summary"
            >
              {{ project.name }}
            </ion-card-title>
            <ion-card-subtitle>{{ project.client }}</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <ion-chip
              v-shared-element="{ scope: 'project', id: project.id, part: 'status', priority: 1 }"
              :color="getStatusColor(project.status)"
            >
              <ion-label>{{ project.status }}</ion-label>
            </ion-chip>
            <p>{{ project.summary }}</p>
          </ion-card-content>
        </ion-card>

        <ion-list inset>
          <ion-item>
            <ion-label>
              <h2>Owner</h2>
              <p>{{ project.owner }}</p>
            </ion-label>
          </ion-item>

          <ion-item>
            <ion-label>
              <h2>Due date</h2>
              <p>{{ project.dueDate }}</p>
            </ion-label>
          </ion-item>

          <ion-item>
            <ion-label>
              <h2>Next step</h2>
              <p>{{ project.nextStep }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
      </template>

      <ion-card v-else>
        <ion-card-header>
          <ion-card-title>Project not found</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-button router-link="/projects">
            Back to projects
          </ion-button>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonChip,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonTitle,
  IonToolbar
} from "@ionic/vue"
import { computed } from "vue"

import { type ProjectStatus, getProject } from "@/data/projects"

const props = defineProps<{
  projectId: string
}>()

const project = computed(() => getProject(props.projectId))

function getStatusColor(status: ProjectStatus) {
  if(status === "Active") {
    return "success"
  }

  if(status === "At risk") {
    return "warning"
  }

  return "medium"
}
</script>
