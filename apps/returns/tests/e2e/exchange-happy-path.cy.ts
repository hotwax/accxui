// Demo narrative: create a same-product exchange → approve → watch the two-step push confirm.
// Runs against the dev server (port 8101) with VITE_RETURNS_BACKEND=stub.
// NOTE: cypress is not installed by default. To run:
//   pnpm --filter returns add -D cypress   (approve the build), then `pnpm --filter returns dev`
//   in one terminal and `pnpm --filter returns test:e2e` in another (log in once if auth blocks).
describe("Exchange happy path (stub backend)", () => {
  it("creates a same-product exchange and confirms it in Shopify", () => {
    cy.visit("/create-return");
    cy.get("ion-input[label='Order ID'] input").type("DEMO-1001");
    cy.contains("ion-button", "Look up order").click();

    // Switch to Exchange mode.
    cy.get("[data-testid=create-mode-exchange]").click();

    // Return one unit of the first line (the replacement is the same product).
    cy.contains("ion-item", "Classic Tee").within(() => {
      cy.get("ion-select").first().click();
    });
    cy.get("ion-select-option").contains("1").click();
    cy.contains("ion-item", "Classic Tee").find("ion-select").last().click();
    cy.get("ion-select-option").first().click();

    // Default fulfillment (Ship to customer) is fine; submit.
    cy.get("[data-testid=create-submit-btn]").click();

    // Detail shows the exchange block as a requested return; approve to drive the push.
    cy.get("[data-testid=detail-exchange-card]").should("exist");
    cy.get("[data-testid=detail-approve-btn]").click();

    // Two-step push settles to "Exchange confirmed".
    cy.contains("Exchange confirmed", { timeout: 15000 });
  });
});
