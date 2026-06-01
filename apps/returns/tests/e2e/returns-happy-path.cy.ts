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

    // Lands on detail as a requested return; approve it to trigger the Shopify sync.
    cy.contains("Shopify sync");
    cy.get("[data-testid=detail-approve-btn]").click();
    cy.contains("Synced", { timeout: 15000 });
  });

  it("creates a return with a goodwill appeasement", () => {
    cy.visit("/create-return");
    cy.get("ion-input[label='Order ID'] input").type("DEMO-1001");
    cy.contains("ion-button", "Look up order").click();

    // Return just one unit of the first line so the rest stays kept (enables the appeasement).
    cy.contains("ion-item", "Classic Tee").within(() => {
      cy.get("ion-select").first().click();
    });
    cy.get("ion-select-option").contains("1").click();
    cy.contains("ion-item", "Classic Tee").find("ion-select").last().click();
    cy.get("ion-select-option").first().click();

    // Turn on the goodwill refund, set an amount, and pick a reason.
    cy.get("[data-testid=create-appeasement-toggle]").click();
    cy.get("[data-testid=create-appeasement-amount] input").type("10");
    cy.get("[data-testid=create-appeasement-reason]").click();
    cy.get("ion-select-option").first().click();

    cy.get("[data-testid=create-submit-btn]").click();

    cy.url().should("include", "/return-detail/");
  });

  it("creates a lost-in-shipment appeasement by picking a lost item", () => {
    cy.visit("/create-return");
    cy.get("ion-input[label='Order ID'] input").type("DEMO-1001");
    cy.contains("ion-button", "Look up order").click();

    // Keep everything (no standard-return selection) so the appeasement is eligible.
    cy.get("[data-testid=create-appeasement-toggle]").click();
    cy.get("[data-testid=create-appeasement-mode-items]").click();

    // Pick one unit of the first lost line.
    cy.get("[data-testid=create-appeasement-items]").contains("ion-item", "Classic Tee").within(() => {
      cy.get("ion-select").first().click();
    });
    cy.get("ion-select-option").contains("1").click();

    // Reason, then submit.
    cy.get("[data-testid=create-appeasement-reason]").click();
    cy.get("ion-select-option").first().click();
    cy.get("[data-testid=create-submit-btn]").click();

    // Lands on the appeasement detail, showing the lost product line + a refund amount.
    cy.url().should("include", "/return-detail/");
    cy.get("[data-testid=detail-appeasement-items]").contains("Classic Tee");
    cy.get("[data-testid=detail-appeasement-amount]").should("contain", "19.99");
  });

  it("shows a Shopify-origin return in the list", () => {
    cy.visit("/tabs/returns");
    cy.contains("ion-badge", "From Shopify");
  });
});
