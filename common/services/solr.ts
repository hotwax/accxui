import api from '../core/remoteApi'
import { commonUtil } from '../utils/commonUtil'

/**
 * Native Moqui Solr client (execute#SolrQuery via admin/search/query).
 *
 * This is the ONLY Solr contract apps should speak. There is no legacy OFBiz
 * `runSolrQuery` shape here — builders author a flat `SolrQuery` and read results
 * through `solrDocs` / `solrTotal` / `solrGroups`.
 */

/** The native Solr JSON Request API contract. `limit`/`offset`/`sort`/`facet` are mapped
 *  onto Solr's `rows`/`start`/`sort`/`json.facet` at the transport boundary. */
export interface SolrQuery {
  query?: string
  filter?: string | string[]
  fields?: string
  sort?: string
  limit?: number
  offset?: number
  facet?: Record<string, unknown>
  params?: Record<string, unknown>
  collection?: string
}

/** The standard Solr response body (what `admin/search/query` wraps under `data.response`). */
export interface SolrResponse {
  responseHeader?: Record<string, unknown>
  response?: { numFound: number; start: number; docs: any[] }
  grouped?: Record<string, any>
  facets?: Record<string, any>
  [key: string]: any
}

function toRequestData(query: SolrQuery) {
  const params: Record<string, unknown> = { ...(query.params ?? {}) }

  if (query.limit !== undefined) params.rows = query.limit
  if (query.offset !== undefined) params.start = query.offset
  if (query.sort) params.sort = query.sort
  if (query.facet) params['json.facet'] = JSON.stringify(query.facet)

  return {
    query: query.query ?? '*:*',
    filter: query.filter,
    fields: query.fields,
    params,
    collection: query.collection
  }
}

/** POST a native Solr query. Resolves with the standard Solr response body; rejects on
 *  transport or Moqui error. */
export async function executeSolrQuery(query: SolrQuery): Promise<SolrResponse> {
  const response = await api({
    url: 'admin/search/query',
    method: 'post',
    data: toRequestData(query)
  }) as any

  if (commonUtil.hasError(response)) return Promise.reject(response.data)

  // admin/search/query wraps the Solr body under data.response; fall back to data itself
  // when an outer envelope is absent.
  return response.data?.response ?? response.data ?? {}
}

export function solrDocs(response: SolrResponse): any[] {
  return response?.response?.docs ?? []
}

export function solrTotal(response: SolrResponse): number {
  return Number(response?.response?.numFound ?? 0)
}

export function solrGroups(response: SolrResponse, field: string): { groups: any[]; ngroups: number } {
  const group = response?.grouped?.[field]
  return {
    groups: group?.groups ?? [],
    ngroups: Number(group?.ngroups ?? group?.matches ?? (group?.groups?.length ?? 0))
  }
}

const SOLR_SPECIALS = /[+\-&|!(){}[\]^"~*?:\\/]/g

/** Escape Solr query special characters in a user-supplied value. */
export function escapeSolrValue(value: string): string {
  return String(value).replace(SOLR_SPECIALS, '\\$&')
}
