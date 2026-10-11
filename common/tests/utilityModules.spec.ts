import { expect, it } from 'vitest';
import { commonUtil } from '../utils/commonUtil';
import { jsonToCsv } from '../utils/csv';
import { parseCronExpression } from '../utils/cron';
import { formatDate } from '../utils/date';
import { getProductIdentificationValue } from '../utils/product';

it('keeps CSV output available through both focused and compatibility imports', async () => {
  const rows = [{ sku: 'SKU-1', label: 'Café' }];
  expect(await jsonToCsv(rows).text()).toBe('sku,label\r\nSKU-1,Café');
  expect(await commonUtil.jsonToCsv(rows).text()).toBe('sku,label\r\nSKU-1,Café');
});
it('keeps the cron timezone option through both import paths', () => {
  expect(parseCronExpression('0 9 * * *', 'UTC').next().toDate().getUTCHours()).toBe(9);
  expect(commonUtil.parseCronExpression('0 9 * * *', 'UTC').next().toDate().getUTCHours()).toBe(9);
});
it('exposes date and product helpers without the compatibility object', () => {
  expect(formatDate('2026-10-02')).toBe('10-02-2026');
  const product = { goodIdentifications: [{ type: 'SKU', value: 'SKU-1' }] };
  expect(getProductIdentificationValue('SKU', product)).toBe('SKU-1');
  expect(commonUtil.getProductIdentificationValue('SKU', product)).toBe('SKU-1');
});
