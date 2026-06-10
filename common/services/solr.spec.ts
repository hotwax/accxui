import { describe, it, expect, vi, beforeEach } from 'vitest'

// Replace the transport + error util so the test never pulls in the real axios stack.
vi.mock('../core/remoteApi', () => ({ default: vi.fn() }))
vi.mock('../utils/commonUtil', () => ({ commonUtil: { hasError: vi.fn(() => false) } }))

import api from '../core/remoteApi'
import { commonUtil } from '../utils/commonUtil'
import { executeSolrQuery, solrDocs, solrTotal, solrGroups, escapeSolrValue } from './solr'

const mockApi = api as unknown as ReturnType<typeof vi.fn>
const mockHasError = commonUtil.hasError as unknown as ReturnType<typeof vi.fn>

function resolveApiWith(data: any) {
  mockApi.mockResolvedValueOnce({ status: 200, data })
}

describe('executeSolrQuery — request mapping', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockHasError.mockReset()
    mockHasError.mockReturnValue(false)
  })

  it('posts to the native endpoint and maps limit/offset/sort/facet onto Solr params', async () => {
    resolveApiWith({ response: { numFound: 0, start: 0, docs: [] } })

    await executeSolrQuery({
      query: 'foo',
      filter: ['docType:PRODUCT'],
      fields: 'productId',
      sort: 'productName asc',
      limit: 25,
      offset: 50,
      facet: { tags: { type: 'terms', field: 'tags' } },
      params: { 'q.op': 'AND' },
      collection: 'enterpriseSearch'
    })

    expect(mockApi).toHaveBeenCalledTimes(1)
    const arg = mockApi.mock.calls[0][0]
    expect(arg.url).toBe('admin/search/query')
    expect(arg.method).toBe('post')
    expect(arg.data).toMatchObject({
      query: 'foo',
      filter: ['docType:PRODUCT'],
      fields: 'productId',
      collection: 'enterpriseSearch'
    })
    expect(arg.data.params).toEqual({
      'q.op': 'AND',
      rows: 25,
      start: 50,
      sort: 'productName asc',
      'json.facet': JSON.stringify({ tags: { type: 'terms', field: 'tags' } })
    })
  })

  it('defaults query to *:* and omits unset mappings', async () => {
    resolveApiWith({ response: { numFound: 0, start: 0, docs: [] } })

    await executeSolrQuery({ filter: 'docType:ORDER' })

    const arg = mockApi.mock.calls[0][0]
    expect(arg.data.query).toBe('*:*')
    expect(arg.data.params).toEqual({})
    expect(arg.data.collection).toBeUndefined()
  })
})

describe('executeSolrQuery — response unwrap', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockHasError.mockReset()
    mockHasError.mockReturnValue(false)
  })

  it('unwraps the double-wrapped Solr body under data.response', async () => {
    const body = { response: { numFound: 2, start: 0, docs: [{ productId: 'A' }, { productId: 'B' }] } }
    resolveApiWith({ response: body })

    const res = await executeSolrQuery({ query: '*:*' })
    expect(res).toEqual(body)
    expect(solrTotal(res)).toBe(2)
  })

  it('falls back to data when no outer response envelope is present', async () => {
    // No top-level `response` key, so the `?? response.data` branch returns data as-is.
    const body = { grouped: { orderId: { ngroups: 1, groups: [] } } }
    resolveApiWith(body)

    const res = await executeSolrQuery({ query: '*:*' })
    expect(res).toEqual(body)
  })

  it('rejects with the error payload when commonUtil.hasError is true', async () => {
    mockHasError.mockReturnValue(true)
    mockApi.mockResolvedValueOnce({ status: 200, data: { errorCode: 'BAD', _ERROR_MESSAGE_: 'nope' } })

    await expect(executeSolrQuery({ query: '*:*' })).rejects.toEqual({ errorCode: 'BAD', _ERROR_MESSAGE_: 'nope' })
  })
})

describe('readers', () => {
  it('solrDocs returns docs or empty array', () => {
    expect(solrDocs({ response: { numFound: 1, start: 0, docs: [{ id: 1 }] } })).toEqual([{ id: 1 }])
    expect(solrDocs({})).toEqual([])
    expect(solrDocs({ grouped: {} })).toEqual([])
  })

  it('solrTotal returns numFound or 0', () => {
    expect(solrTotal({ response: { numFound: 42, start: 0, docs: [] } })).toBe(42)
    expect(solrTotal({})).toBe(0)
  })

  it('solrGroups returns groups + ngroups, falling back to matches/length', () => {
    const res = { grouped: { orderId: { ngroups: 7, groups: [{ groupValue: 'O1' }] } } }
    expect(solrGroups(res, 'orderId')).toEqual({ groups: [{ groupValue: 'O1' }], ngroups: 7 })

    const noNgroups = { grouped: { orderId: { matches: 3, groups: [{ groupValue: 'O1' }, { groupValue: 'O2' }] } } }
    expect(solrGroups(noNgroups, 'orderId').ngroups).toBe(3)

    expect(solrGroups({}, 'orderId')).toEqual({ groups: [], ngroups: 0 })
  })
})

describe('escapeSolrValue', () => {
  it('escapes Solr special characters', () => {
    expect(escapeSolrValue('a+b')).toBe('a\\+b')
    expect(escapeSolrValue('Facility (A)')).toBe('Facility \\(A\\)')
    expect(escapeSolrValue('a:b/c')).toBe('a\\:b\\/c')
    expect(escapeSolrValue('plain')).toBe('plain')
  })
})
