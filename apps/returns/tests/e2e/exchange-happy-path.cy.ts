// Demo narrative: create a same-product exchange with fulfillment chosen at create time.
// The detail screen is fully read-only — no approve/complete/cancel buttons exist.
// Runs against the dev server (port 8101) with VITE_RETURNS_BACKEND=stub.
// NOTE: cypress is not installed by default. To run:
//   pnpm --filter returns add -D cypress   (approve the build), then `pnpm --filter returns dev`
//   in one terminal and `pnpm --filter returns test:e2e` in another.
describe("Exchange happy path (stub backend)", () => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Open the Ionic popover/action-sheet for an ion-select and pick the option whose text matches. */
  function pickSelectOption(testid: string, optionText: string) {
    cy.get(`[data-testid=${testid}]`).click();
    cy.get("ion-select-option").contains(optionText).click();
  }

  /** Look up DEMO-1001, switch to exchange mode, then pick 1 unit + first reason for the first line. */
  function setupExchangeForm() {
    cy.visit("/create-return");
    cy.get("[data-testid=create-orderid-input] input").type("DEMO-1001");
    cy.get("[data-testid=create-lookup-btn]").click();

    // Switch to Exchange mode.
    cy.get("[data-testid=create-mode-exchange]").click();

    // Pick qty = 1 for the first line (Classic Tee).
    cy.contains("ion-item", "Classic Tee").within(() => {
      cy.get("ion-select").first().click();
    });
    cy.get("ion-select-option").contains("1").click();

    // Pick the first reason for that line.
    cy.contains("ion-item", "Classic Tee").find("ion-select").last().click();
    cy.get("ion-select-option").first().click();

    // The fulfillment segment is now visible.
    cy.get("[data-testid=create-fulfillment-segment]").should("exist");
  }

  // ── Test 1: Shipped exchange ──────────────────────────────────────────────

  it("creates a shipped exchange and shows it as confirmed in the read-only detail", () => {
    setupExchangeForm();

    // SHIPPED is the default; assert the segment button is rendered (the address block follows).
    cy.get("[data-testid=create-fulfillment-shipped]").should("exist");

    // Pick a shipment method via the Ionic select.
    pickSelectOption("create-shipment-method", "Standard Shipping");

    // The address block should be pre-filled from the demo order.
    cy.get("[data-testid=create-ship-address1] input").should("have.value", "500 Congress Ave");
    cy.get("[data-testid=create-ship-city] input").should("have.value", "Austin");
    cy.get("[data-testid=create-ship-postalCode] input").should("have.value", "78701");

    // Submit.
    cy.get("[data-testid=create-submit-btn]").click();

    // ── Exchange-detail assertions ──────────────────────────────────────────

    // The Exchange badge is visible.
    cy.get("[data-testid=exchange-detail-badge]").should("exist");

    // Both halves of the exchange are present.
    cy.get("[data-testid=exchange-returning-section]").should("exist");
    cy.get("[data-testid=exchange-replacement-section]").should("exist");
    cy.get("[data-testid=exchange-replacement-order]").should("exist");

    // The detail is fully read-only — none of the old action buttons exist.
    cy.get("[data-testid=exchange-approve-btn]").should("not.exist");
    cy.get("[data-testid=exchange-complete-btn]").should("not.exist");
    cy.get("[data-testid=exchange-cancel-btn]").should("not.exist");

    // The sync chip settles to "Exchange confirmed" (the stub pushes in two polls).
    cy.contains("Exchange confirmed", { timeout: 15000 });

    // The replacement panel reads "Replacement approved — in fulfillment" (SHIPPED / ORDER_APPROVED).
    cy.get("[data-testid=exchange-replacement-section]").contains("Replacement approved — in fulfillment");
  });

  // ── Test 2: Immediate (hand-over) exchange ────────────────────────────────

  it("creates an immediate exchange and shows the replacement as completed", () => {
    setupExchangeForm();

    // Switch fulfillment to "Hand over now".
    cy.get("[data-testid=create-fulfillment-immediate]").click();

    // Pick a facility via the Ionic select.
    pickSelectOption("create-fulfillment-facility", "Downtown Store");

    // Submit.
    cy.get("[data-testid=create-submit-btn]").click();

    // ── Exchange-detail assertions ──────────────────────────────────────────

    cy.get("[data-testid=exchange-detail-badge]").should("exist");
    cy.get("[data-testid=exchange-returning-section]").should("exist");
    cy.get("[data-testid=exchange-replacement-section]").should("exist");

    // No action buttons — read-only detail.
    cy.get("[data-testid=exchange-approve-btn]").should("not.exist");
    cy.get("[data-testid=exchange-cancel-btn]").should("not.exist");

    // Sync chip resolves to "Exchange confirmed".
    cy.contains("Exchange confirmed", { timeout: 15000 });

    // The replacement panel reads "Replacement completed" (IMMEDIATE / ORDER_COMPLETED).
    cy.get("[data-testid=exchange-replacement-section]").contains("Replacement completed");
  });
});
