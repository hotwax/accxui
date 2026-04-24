import { describe, it, expect } from 'vitest';
import { useSolrSearch } from './useSolrSearch';

const { prepareOrderLookupQuery } = useSolrSearch();

describe('prepareOrderLookupQuery', () => {
  it('should have default filters and params', () => {
    const query = {};
    const payload = prepareOrderLookupQuery(query);
    expect(payload.json.filter).toEqual(["docType: ORDER", "orderTypeId: SALES_ORDER"]);
    expect(payload.json.params.q.op).toBe("AND");
    expect(payload.json.query).toBe("*:*");
  });

  it('should handle shipmentMethodTypeId filters correctly', () => {
    const query1 = { storePickup: true };
    const payload1 = prepareOrderLookupQuery(query1);
    expect(payload1.json.filter).toContain('{!tag=orderLookupFilter}shipmentMethodTypeId: (STOREPICKUP)');

    const query2 = { shipFromStore: true };
    const payload2 = prepareOrderLookupQuery(query2);
    expect(payload2.json.filter).toContain('{!tag=orderLookupFilter}shipmentMethodTypeId: (STANDARD)');

    const query3 = { storePickup: true, shipFromStore: true };
    const payload3 = prepareOrderLookupQuery(query3);
    expect(payload3.json.filter).toContain('{!tag=orderLookupFilter}shipmentMethodTypeId: (STOREPICKUP OR STANDARD)');
  });

  it('should handle array filters correctly', () => {
    const query = {
      facility: ['Facility A', 'Facility B'],
      productStore: ['Store A'],
      channel: ['Web', 'Mobile'],
      status: ['Ordered', 'Completed']
    };
    const payload = prepareOrderLookupQuery(query);

    expect(payload.json.filter).toContain('{!tag=orderLookupFilter}facilityName: ("Facility A" OR "Facility B")');
    expect(payload.json.filter).toContain('{!tag=orderLookupFilter}productStoreName: ("Store A")');
    expect(payload.json.filter).toContain('{!tag=orderLookupFilter}salesChannelDesc: ("Web" OR "Mobile")');
    expect(payload.json.filter).toContain('{!tag=orderLookupFilter}orderStatusDesc: ("Ordered" OR "Completed")');
  });

  it('should escape special characters in array filters', () => {
    const query = {
      facility: ['Facility (A)', 'Facility [B]']
    };
    const payload = prepareOrderLookupQuery(query);
    expect(payload.json.filter).toContain('{!tag=orderLookupFilter}facilityName: ("Facility \\(A\\)" OR "Facility \\[B\\]")');
  });

  it('should handle queryString correctly', () => {
    const query = { queryString: 'testOrder' };
    const payload = prepareOrderLookupQuery(query);
    expect(payload.json.params.defType).toBe("edismax");
    expect(payload.json.query).toBe("*testOrder*");
    expect(payload.json.params.qf).toBe("orderName orderId customerPartyName productId internalName parentProductName");
  });

  it('should handle date filters correctly', () => {
    const query1 = { date: '2023-01-01T00:00:00Z TO 2023-01-31T23:59:59Z' };
    const payload1 = prepareOrderLookupQuery(query1);
    expect(payload1.json.filter).toContain('{!tag=orderLookupFilter}orderDate: [2023-01-01T00:00:00Z TO 2023-01-31T23:59:59Z]');

    const query2 = { date: 'custom', fromDate: '2023-01-01T12:00:00Z', toDate: '2023-01-02T12:00:00Z' };
    const payload2 = prepareOrderLookupQuery(query2);
    expect(payload2.json.filter).toContain('{!tag=orderLookupFilter}orderDate: [2023-01-01T00:00:00Z TO 2023-01-02T23:59:59Z]');

    const query3 = { date: 'custom', fromDate: '2023-01-01T12:00:00Z' };
    const payload3 = prepareOrderLookupQuery(query3);
    expect(payload3.json.filter).toContain('{!tag=orderLookupFilter}orderDate: [2023-01-01T00:00:00Z TO *]');
  });
});
