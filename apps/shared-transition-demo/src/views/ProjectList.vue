<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Projects</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list-header>
        <ion-label>
          <h1>Open work</h1>
          <p>{{ projects.length }} projects across operations and product data.</p>
        </ion-label>
      </ion-list-header>

      <ion-list inset>
        <ion-item
          v-for="project in projects"
          :key="project.id"
          button
          detail
          @click="openProject(project)"
        >
          <ion-label
            v-shared-element="{ scope: 'project', id: project.id, part: 'summary' }"
            class="shared-summary"
          >
            <h2>{{ project.name }}</h2>
            <p>{{ project.client }} · {{ project.summary }}</p>
          </ion-label>

          <ion-chip
            slot="end"
            v-shared-element="{ scope: 'project', id: project.id, part: 'status' }"
            :color="getStatusColor(project.status)"
          >
            <ion-label>{{ project.status }}</ion-label>
          </ion-chip>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonChip,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonPage,
  IonTitle,
  IonToolbar
} from "@ionic/vue"

import { useSharedElementTransition } from "@/composables/useSharedElementTransition"
import { type Project, type ProjectStatus, projects } from "@/data/projects"

const sharedElements = useSharedElementTransition()

function getStatusColor(status: ProjectStatus) {
  if(status === "Active") {
    return "success"
  }

  if(status === "At risk") {
    return "warning"
  }

  return "medium"
}

function openProject(project: Project) {
  sharedElements.navigate({
    to: `/projects/${project.id}`,
    direction: "forward",
    action: "push",
    elements: [
      { scope: "project", id: project.id, part: "summary" },
      { scope: "project", id: project.id, part: "status" }
    ]
  })
}
</script>
