export type ProjectStatus = "Active" | "Planning" | "At risk"

export type Project = {
  id: string
  name: string
  client: string
  status: ProjectStatus
  owner: string
  dueDate: string
  summary: string
  nextStep: string
}

export const projects: Project[] = [
  {
    id: "PX-1001",
    name: "Receiving Accuracy",
    client: "North Warehouse",
    status: "Active",
    owner: "Mira",
    dueDate: "Jun 14",
    summary: "Tighten variance review before receipts post to inventory.",
    nextStep: "Review exception counts with receiving leads."
  },
  {
    id: "PX-1002",
    name: "Cycle Count Refresh",
    client: "Store Operations",
    status: "Planning",
    owner: "Dev",
    dueDate: "Jun 20",
    summary: "Simplify task queues and count review for store teams.",
    nextStep: "Confirm mobile scan flow with operators."
  },
  {
    id: "PX-1003",
    name: "Order Holds",
    client: "Commerce Hub",
    status: "At risk",
    owner: "Nina",
    dueDate: "Jun 24",
    summary: "Move hold release decisions closer to order detail context.",
    nextStep: "Validate release reasons against Moqui statuses."
  },
  {
    id: "PX-1004",
    name: "Product Cleanup",
    client: "PIM",
    status: "Active",
    owner: "Sam",
    dueDate: "Jul 02",
    summary: "Resolve missing dimensions and duplicate identifiers.",
    nextStep: "Batch top data-quality failures by product family."
  }
]

export function getProject(projectId: string) {
  return projects.find((project) => project.id === projectId)
}
