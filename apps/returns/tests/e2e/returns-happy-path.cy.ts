// Demo narrative: create a return → push to Shopify → watch it sync; list shows a Shopify-origin return.
// Runs against the dev server (port 8101) with VITE_RETURNS_BACKEND=stub.
// NOTE: cypress is not installed by default (pnpm build-script policy). To run:
//   pnpm --filter returns add -D cypress   (approve the build), then `pnpm --filter returns dev`
//   in one terminal and `pnpm --filter returns test:e2e` in another (log in once if auth blocks).
describe("Returns happy path (stub backend)", () => {
  it("creates a return and syncs it to Shopify", () => {
    cy.visit("/create-return");
    cy.get("ion-input[label='Order ID'] input").type("DEMO-1001");
    cy.contains("ion-button", "Look up order").click();

    cy.contains("ion-item", "Classic Tee").within(() => {
      cy.get("ion-select").first().click();
    });
    cy.get("ion-select-option").contains("1").click();
    // pick a reason on the same line
    cy.contains("ion-item", "Classic Tee").find("ion-select").last().click();
    cy.get("ion-select-option").first().click();

    cy.get("[data-testid=create-submit-btn]").click();

    // Lands on detail; push and watch sync
    cy.contains("Shopify sync");
    cy.get("[data-testid=detail-push-btn]").click();
    cy.contains("Synced", { timeout: 15000 });
  });

  it("shows a Shopify-origin return in the list", () => {
    cy.visit("/tabs/returns");
    cy.contains("ion-badge", "From Shopify");
  });
});
