import api, { client } from "../core/remoteApi";
import { userProfileTransformRule } from "./mappings/user";
import { RequestPayload, Response, User } from "./types";
import { hasError, jsonParse } from "../utils";
import { transform } from 'node-json-transform';

const SYSTEM_TYPE = import.meta.env.VITE_SYSTEM_TYPE || "OFBIZ";

async function getProfile(): Promise<User | Response> {
  try {
    const resp = await api({
      url: "user-profile", 
      method: "get",
    }) as any;

    if (resp.status === 200 && !hasError(resp)) {
      const user: User = transform(resp.data, userProfileTransformRule)

      return Promise.resolve(user);
    } else {
      return Promise.reject({
        code: 'error',
        message: 'Failed to fetch user profile information',
        serverResponse: resp.data
      })
    }
  } catch(err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function omsSetProductIdentificationPref(eComStoreId: string, productIdentificationPref: any): Promise<any> {

  let isSettingExists = false;

  const payload = {
    "inputFields": {
      "productStoreId": eComStoreId,
      "settingTypeEnumId": "PRDT_IDEN_PREF"
    },
    "entityName": "ProductStoreSetting",
    "fieldList": ["productStoreId", "settingTypeEnumId"],
    "viewSize": 1
  }

  try {
    const resp = await api({
      url: "performFind",
      method: "get",
      params: payload,
      cache: true
    }) as any;
    if(!hasError(resp) && resp.data.docs?.length) {
      isSettingExists = true
    }
  } catch(err) {
    console.error(err)
  }

  // when fromDate is not found then reject the call with a message
  if(!isSettingExists) {
    return Promise.reject('product store setting is missing');
  }

  const params = {
    "productStoreId": eComStoreId,
    "settingTypeEnumId": "PRDT_IDEN_PREF",
    "settingValue": JSON.stringify(productIdentificationPref)
  }

  try {
    const resp = await api({
      url: "service/updateProductStoreSetting",
      method: "post",
      data: params
    }) as any;

    if(!hasError(resp)) {
      return Promise.resolve(productIdentificationPref)
    } else {
      return Promise.reject({
        code: 'error',
        message: 'Failed to set product identification pref',
        serverResponse: resp.data
      })
    }
  } catch(err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function omsCreateProductIdentificationPref(eComStoreId: string): Promise<any> {
  const prefValue = {
    primaryId: 'productId',
    secondaryId: ''
  }

  const params = {
    "productStoreId": eComStoreId,
    "settingTypeEnumId": "PRDT_IDEN_PREF",
    "settingValue": JSON.stringify(prefValue)
  }

  try {
    await api({
      url: "service/createProductStoreSetting",
      method: "post",
      data: params
    });
  } catch(err) {
    console.error(err)
  }

  // not checking for resp success and fail case as every time we need to update the state with the
  // default value when creating a pref
  return prefValue;
}

async function omsGetProductIdentificationPref(eComStoreId: string): Promise<any> {

  const productIdentifications = {
    'primaryId': 'productId',
    'secondaryId': ''
  }

  const payload = {
    "inputFields": {
      "productStoreId": eComStoreId,
      "settingTypeEnumId": "PRDT_IDEN_PREF"
    },
    "entityName": "ProductStoreSetting",
    "fieldList": ["settingValue", "settingTypeEnumId"],
    "viewSize": 1
  }

  try {
    const resp = await api({
      url: "performFind",
      method: "get",
      params: payload,
      cache: true
    }) as any;

    if(!hasError(resp) && resp.data.docs[0].settingValue) {
      const respValue = JSON.parse(resp.data.docs[0].settingValue)
      productIdentifications['primaryId'] = respValue['primaryId']
      productIdentifications['secondaryId'] = respValue['secondaryId']
    } else if(resp.data.error === "No record found") {  // TODO: remove this check once we have the data always available by default
      await omsCreateProductIdentificationPref(eComStoreId)
    }
  } catch(err) {
    console.error(err)
  }

  return productIdentifications
}


async function logout(): Promise<any> {
  try {
    const resp: any = await api({
      url: "logout",
      method: "get"
    });

    if(resp.status != 200) {
      throw resp.data;
    }

    return Promise.resolve(resp.data)
  } catch(err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function omsGetUserFacilities(token: any, baseURL: string, partyId: string, facilityGroupId: any, isAdminUser = false, payload?: any): Promise<any> {
  try {
    const params = {
      "inputFields": {} as any,
      "filterByDate": "Y",
      "viewSize": 200,
      "distinct": "Y",
      "noConditionFind" : "Y",
    } as any
    
    if (facilityGroupId) {
      params.entityName = "FacilityGroupAndParty";
      params.fieldList = ["facilityId", "facilityName", "sequenceNum", "facilityTypeId"];
      params.fromDateName = "FGMFromDate";
      params.thruDateName = "FGMThruDate";
      params.orderBy = "sequenceNum ASC | facilityName ASC";
      params.inputFields["facilityGroupId"] = facilityGroupId;
    } else {
      params.entityName = "FacilityAndParty";
      params.fieldList = ["facilityId", "facilityName", "facilityTypeId"];
      params.inputFields["facilityParentTypeId"] = "VIRTUAL_FACILITY";
      params.inputFields["facilityParentTypeId_op"] = "notEqual";
      params.orderBy = "facilityName ASC";
    }
    if (!isAdminUser) {
      params.inputFields["partyId"] = partyId;
    }
    let resp = {} as any;
    resp = await client({
      url: "performFind",
      method: "get",
      baseURL,
      params,
      headers: {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });
    if (resp.status === 200 && !hasError(resp)) {
      return Promise.resolve(resp.data.docs);
    } else {
      return Promise.reject({
        code: 'error',
        message: 'Failed to fetch user facilities',
        serverResponse: resp.data
      })
    }
  } catch(error: any) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: error
    })

  }
}

async function omsGetUserPreference(token: any, baseURL: string, userPrefTypeId: string): Promise<any> {
  try {
    const resp = await client({
      url: "service/getUserPreference",
      method: "post",
      data: { userPrefTypeId },
      baseURL,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });
    if (hasError(resp)) {
      throw resp.data
    }
    return Promise.resolve(jsonParse(resp.data.userPrefValue));
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function omsSetUserPreference(payload: any): Promise<any> {
  try {
    const resp: any = await api({
      url: "service/setUserPreference",
      method: "post",
      data: {
        userPrefTypeId: payload.userPrefTypeId,
        userPrefValue: payload.userPrefValue,
      }
    });

    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

const omsSetUserLocale = async (payload: any): Promise<any> => {
  try {
    const resp: any = await api({
      url: "setUserLocale",
      method: "post",
      data: payload
    })

    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data
    }
  } catch (error) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: error
    })
  }
}

const omsSetUserTimeZone = async (payload: any): Promise<any> => {
  try {
    const resp: any = await api({
      url: "setUserTimeZone",
      method: "post",
      data: payload
    });

    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data
    }
  } catch (error) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: error
    })
  }
}

const omsGetAvailableTimeZones = async (): Promise <any>  => {
  try {
    const resp: any = await api({
      url: "getAvailableTimeZones",
      method: "get",
      cache: true
    });

    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data
    }
  } catch (error) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: error
    })
  }
}

async function omsGetEComStoresByFacility(token: any, baseURL: string, vSize = 100, facilityId?: string): Promise<Response> {

  if (!facilityId) {
    return Promise.reject({
      code: 'error',
      message: 'FacilityId is missing',
      serverResponse: 'FacilityId is missing'
    });
  }

  const filters = {
    facilityId: facilityId
  } as any;

  const params = {
    "inputFields": {
      "storeName_op": "not-empty",
      ...filters
    },
    "viewSize": vSize,
    "fieldList": ["productStoreId", "storeName", "productIdentifierEnumId"],
    "entityName": "ProductStoreFacilityDetail",
    "distinct": "Y",
    "noConditionFind": "Y",
    "filterByDate": 'Y',
  };

  try {
    const resp = await client({
      url: "performFind",
      method: "get",
      baseURL,
      params,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });
    if (resp.status === 200 && !hasError(resp)) {
      return Promise.resolve(resp.data.docs);
    } else {
      throw resp.data
    }
  } catch(error) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: error
    })
  }
}

async function omsGetEComStores(token: any, baseURL: string, vSize = 100): Promise<any> {
  const params = {
    "viewSize": vSize,
    "fieldList": ["productStoreId", "storeName", "productIdentifierEnumId"],
    "entityName": "ProductStore",
    "distinct": "Y",
    "noConditionFind": "Y"
  };

  try {
    const resp = await client({
      url: "performFind",
      method: "get",
      baseURL,
      params,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }) as any;
    if(!hasError(resp)) {
      return Promise.resolve(resp.data.docs);
    } else {
      throw resp.data
    }
  } catch(error) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: error
    })
  }
}

async function maargSetUserTimeZone(payload: any): Promise<any> {
  console.log("Payload in setUserTimeZone: ", payload);
  try {
    const resp = await api({
      url: "admin/user/profile",
      method: "POST",
      data: payload,
    }) as any;
    return Promise.resolve(resp.data);
  } catch (error: any) {
    return Promise.reject({
      code: "error",
      message: "Failed to set user time zone",
      serverResponse: error
    });
  }
}

async function maargSetUserLocale(payload: any): Promise<any> {
  payload.locale = payload.newLocale;
  try {
    const resp = await api({
      url: "admin/user/profile",
      method: "POST",
      data: payload,
    }) as any;
    return Promise.resolve(resp.data);
  } catch (error: any) {
    return Promise.reject({
      code: "error",
      message: "Failed to set user locale",
      serverResponse: error
    });
  }
}

const maargGetAvailableTimeZones = async (): Promise <any>  => {
  try {
    const resp: any = await api({
      url: "admin/user/getAvailableTimeZones",
      method: "get",
      cache: true
    });

    return Promise.resolve(resp.data?.timeZones)
  } catch(error) {
    return Promise.reject({
      code: "error",
      message: "Failed to fetch available timezones",
      serverResponse: error
    })
  }
}

const maargLoginShopifyAppUser = async (baseURL: string, payload: any): Promise <any> => {
  try {
    const resp: any = await client({
      url: "app-bridge/login",
      method: "post",
      baseURL,
      data: payload
    });
    return Promise.resolve(resp.data);
  } catch (error: any) {
    return Promise.reject({
      code: "error",
      message: "Failed to Login Shopify App User",
      serverResponse: error
    })
  }
}

async function maargFetchFacilitiesByGroup(facilityGroupId: string, baseURL?: string, token?: string, payload?: any): Promise <any> {
  let params: RequestPayload = {
    url: "oms/groupFacilities",
    method: "GET",
    params: {
      facilityGroupId,
      pageSize: 500,
      ...payload
    }
  }

  let resp = {} as any;

  try {
    if(token && baseURL) {
      params = {
        ...params,
        baseURL,
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        }
      }
  
      resp = await client(params);
    } else {
      resp = await api(params);
    }

    // Filtering facilities on which thruDate is set, as we are unable to pass thruDate check in the api payload
    // Considering that the facilities will always have a thruDate of the past.
    const facilities = resp.data.filter((facility: any) => !facility.thruDate)
    return Promise.resolve(facilities)
  } catch(error) {
    return Promise.reject({
      code: "error",
      message: "Failed to fetch facilities for group",
      serverResponse: error
    })
  }
}

async function maargFetchFacilitiesByParty(partyId: string, baseURL?: string, token?: string, payload?: any): Promise <Array<any> | Response> {
  let params: RequestPayload = {
    url: `inventory-cycle-count/user/${partyId}/facilities`,
    method: "GET",
    params: {
      ...payload,
      pageSize: 500
    }
  }

  let resp = {} as any;

  try {
    if(token && baseURL) {
      params = {
        ...params,
        baseURL,
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        }
      }
  
      resp = await client(params);
    } else {
      resp = await api(params);
    }

    // Filtering facilities on which thruDate is set, as we are unable to pass thruDate check in the api payload
    // Considering that the facilities will always have a thruDate of the past.
    const facilities = resp.data.filter((facility: any) => !facility.thruDate)
    return Promise.resolve(facilities)
  } catch(error) {
    return Promise.reject({
      code: "error",
      message: "Failed to fetch user associated facilities",
      serverResponse: error
    })
  }
}

async function maargFetchFacilities(token: string, baseURL: string, partyId: string, facilityGroupId: string, isAdminUser: boolean, payload: Object): Promise <any> {
  let facilityIds: Array<string> = [];
  let filters: any = {};
  let resp = {} as any

  // Fetch the facilities associated with party
  if(partyId && !isAdminUser) {
    try {
      resp = await maargFetchFacilitiesByParty(partyId, baseURL, token)

      facilityIds = resp.map((facility: any) => facility.facilityId);
      if (!facilityIds.length) {
        return Promise.reject({
          code: 'error',
          message: 'Failed to fetch user facilities',
          serverResponse: resp.data
        })
      }
    } catch(error) {
      return Promise.reject({
        code: 'error',
        message: 'Failed to fetch user facilities',
        serverResponse: error
      })
    }
  }

  if(facilityIds.length) {
    filters = {
      facilityId: facilityIds.join(","),
      facilityId_op: "in",
      pageSize: facilityIds.length
    }
  }

  // Fetch the facilities associated with group
  if(facilityGroupId) {
    try {
      resp = await maargFetchFacilitiesByGroup(facilityGroupId, baseURL, token, filters)

      facilityIds = resp.map((facility: any) => facility.facilityId);
      if (!facilityIds.length) {
        return Promise.reject({
          code: 'error',
          message: 'Failed to fetch user facilities',
          serverResponse: resp.data
        })
      }
    } catch(error) {
      return Promise.reject({
        code: 'error',
        message: 'Failed to fetch user facilities',
        serverResponse: error
      })
    }
  }

  if(facilityIds.length) {
    filters = {
      facilityId: facilityIds.join(","),
      facilityId_op: "in",
      pageSize: facilityIds.length
    }
  }

  let params: RequestPayload = {
    url: "oms/facilities",
    method: "GET",
    params: {
      pageSize: 500,
      ...payload,
      ...filters
    }
  }

  let facilities: Array<any> = []

  try {
    if(token && baseURL) {
      params = {
        ...params,
        baseURL,
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        }
      }
  
      resp = await client(params);
    } else {
      resp = await api(params);
    }

    facilities = resp.data
  } catch(error) {
    return Promise.reject({
      code: "error",
      message: "Failed to fetch facilities",
      serverResponse: error
    })
  }

  return Promise.resolve(facilities)
}

async function maargGetEComStores(token?: string, baseURL?: string, pageSize = 100): Promise <any> {
  let params: RequestPayload = {
    url: "oms/productStores",
    method: "GET",
    params: {
      pageSize
    }
  }

  let resp = {} as any;
  let stores: Array<any> = []

  try {
    if(token && baseURL) {
      params = {
        ...params,
        baseURL,
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        }
      }
  
      resp = await client(params);
    } else {
      resp = await api(params);
    }

    stores = resp.data
  } catch(error) {
    return Promise.reject({
      code: "error",
      message: "Failed to fetch product stores",
      serverResponse: error
    })
  }

  return Promise.resolve(stores)
}

async function maargGetEComStoresByFacility(token?: string, baseURL?: string, pageSize = 100, facilityId?: any): Promise <any> {
  let params: RequestPayload = {
    url: `oms/facilities/${facilityId}/productStores`,
    method: "GET",
    params: {
      pageSize,
      facilityId
    }
  }

  let resp = {} as any;
  let stores: Array<any> = []

  try {
    if(token && baseURL) {
      params = {
        ...params,
        baseURL,
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        }
      }
  
      resp = await client(params);
    } else {
      resp = await api(params);
    }

    // Filtering stores on which thruDate is set, as we are unable to pass thruDate check in the api payload
    // Considering that the stores will always have a thruDate of the past.
    stores = resp.data.filter((store: any) => !store.thruDate)
  } catch(error) {
    return Promise.reject({
      code: "error",
      message: "Failed to fetch facility associated product stores",
      serverResponse: error
    })
  }

  if(!stores.length) return Promise.resolve(stores)

  // Fetching all stores for the store name
  let productStoresMap = {} as any;
  try {
    const productStores = await maargGetEComStores(token, baseURL, 200);
    productStores.map((store: any) => productStoresMap[store.productStoreId] = store.storeName)
  } catch(error) {
    console.error(error);
  }

  stores.map((store: any) => store.storeName = productStoresMap[store.productStoreId])
  return Promise.resolve(stores)
}

async function maargGetUserPreference(token: any, baseURL: string, preferenceKey: string, userId: any): Promise <any> {
  let params: RequestPayload = {
    url: "admin/user/preferences",
    method: "GET",
    params: {
      pageSize: 1,
      userId,
      preferenceKey
    }
  }

  let resp = {} as any;
  try {
    if(token && baseURL) {
      params = {
        ...params,
        baseURL,
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        }
      }
  
      resp = await client(params);
    } else {
      resp = await api(params);
    }

    return Promise.resolve(resp.data[0]?.preferenceValue ? jsonParse(resp.data[0]?.preferenceValue) : "")
  } catch(error) {
    return Promise.reject({
      code: "error",
      message: "Failed to get user preference",
      serverResponse: error
    })
  }
}

async function maargUpdateUserPreference(payload: any): Promise<any> {
  try {
    const resp = await api({
      url: "admin/user/preferences",
      method: "PUT",
      data: {
        userId: payload.userId,
        preferenceKey: payload.userPrefTypeId,
        preferenceValue: payload.userPrefValue,
      },
    }) as any;
    return Promise.resolve(resp.data)
  } catch(error: any) {
    return Promise.reject({
      code: "error",
      message: "Failed to update user preference",
      serverResponse: error
    })
  }
}

async function maargGetProductIdentificationPref(productStoreId: any): Promise<any> {
  const productIdentifications = {
    primaryId: "productId",
    secondaryId: ""
  }

  try {
    const resp = await api({
      url: `oms/productStores/${productStoreId}/settings`,
      method: "GET",
      params: {
        productStoreId,
        settingTypeEnumId: "PRDT_IDEN_PREF"
      }
    }) as any;

    const settings = resp.data
    if(settings[0]?.settingValue) {
      const respValue = JSON.parse(settings[0].settingValue)
      productIdentifications['primaryId'] = respValue['primaryId']
      productIdentifications['secondaryId'] = respValue['secondaryId']
    } else {
      await maargCreateProductIdentificationPref(productStoreId)
    }
  } catch(error: any) {
    return Promise.reject({
      code: "error",
      message: "Failed to get product identification pref",
      serverResponse: error
    })
  }

  return productIdentifications;
}

async function maargCreateProductIdentificationPref(productStoreId: string): Promise<any> {
  const prefValue = {
    primaryId: "productId",
    secondaryId: ""
  }

  try {
    await api({
      url: `oms/productStores/${productStoreId}/settings`,
      method: "POST",
      data: {
        productStoreId,
        settingTypeEnumId: "PRDT_IDEN_PREF",
        settingValue: JSON.stringify(prefValue)
      }
    });
  } catch(err) {
    console.error(err)
  }

  // not checking for resp success and fail case as every time we need to update the state with the
  // default value when creating a pref
  return prefValue;
}


async function maargSetProductIdentificationPref(productStoreId: string, productIdentificationPref: any): Promise<any> {
  let resp = {} as any, isSettingExists = false;

  try {
    resp = await api({
      url: `oms/productStores/${productStoreId}/settings`,
      method: "GET",
      params: {
        productStoreId,
        settingTypeEnumId: "PRDT_IDEN_PREF"
      }
    });

    if(resp.data[0]?.settingTypeEnumId) isSettingExists = true
  } catch(err) {
    console.error(err)
  }

  if(!isSettingExists) {
    return Promise.reject({
      code: "error",
      message: "product store setting is missing",
      serverResponse: resp.data
    })
  }

  try {
    resp = await api({
      url: `oms/productStores/${productStoreId}/settings`,
      method: "POST",
      data: {
        productStoreId,
        settingTypeEnumId: "PRDT_IDEN_PREF",
        settingValue: JSON.stringify(productIdentificationPref)
      }
    });

    return Promise.resolve(productIdentificationPref)
  } catch(error) {
    return Promise.reject({
      code: "error",
      message: "Failed to set product identification pref",
      serverResponse: error
    })
  }
}

const getAvailableTimeZones = async () => {
  if(SYSTEM_TYPE === "MOQUI") {
    return await maargGetAvailableTimeZones()
  } else {
    return await omsGetAvailableTimeZones()
  }
}

async function getUserFacilities(token: any, baseURL: string, partyId: string, facilityGroupId: any, isAdminUser = false, payload = {}) {
  if(SYSTEM_TYPE === "MOQUI") {
    return await maargFetchFacilities(token, baseURL, partyId, facilityGroupId, isAdminUser, payload)
  } else {
    return await omsGetUserFacilities(token, baseURL, partyId, facilityGroupId, isAdminUser, payload)
  }
}

async function fetchFacilities(token: any, baseURL: string, partyId: string, facilityGroupId: any, isAdminUser = false, payload = {}) {
  return await maargFetchFacilities(token, baseURL, partyId, facilityGroupId, isAdminUser, payload);
}

async function fetchFacilitiesByGroup(facilityGroupId: string, baseURL?: string, token?: string, payload?: any) {
  return await maargFetchFacilitiesByGroup(facilityGroupId, baseURL, token, payload);
}

async function fetchFacilitiesByParty(partyId: string, baseURL?: string, token?: string, payload?: any) {
  return await maargFetchFacilitiesByParty(partyId, baseURL, token, payload);
}

async function getEComStores(token: any, baseURL: string, vSize = 100) {
  if(SYSTEM_TYPE === "MOQUI") {
    return await maargGetEComStores(token, baseURL, vSize)
  } else {
    return await omsGetEComStores(token, baseURL, vSize)
  }
}

async function getEComStoresByFacility(token: any, baseURL: string, vSize = 100, facilityId?: string) {
  if(SYSTEM_TYPE === "MOQUI") {
    return await maargGetEComStoresByFacility(token, baseURL, vSize, facilityId)
  } else {
    return await omsGetEComStoresByFacility(token, baseURL, vSize, facilityId)
  }
}

async function getUserPreference(token: any, baseURL: string, userPrefTypeId: string, userId = "") {
  if(SYSTEM_TYPE === "MOQUI") {
    return await maargGetUserPreference(token, baseURL, userPrefTypeId, userId)
  } else {
    return await omsGetUserPreference(token, baseURL, userPrefTypeId)
  }
}

async function getProductIdentificationPref(eComStoreId: string) {
  if(SYSTEM_TYPE === "MOQUI") {
    return await maargGetProductIdentificationPref(eComStoreId)
  } else {
    return await omsGetProductIdentificationPref(eComStoreId)
  }
}

async function setProductIdentificationPref(eComStoreId: string, productIdentificationPref: any) {
  if(SYSTEM_TYPE) {
    return await maargSetProductIdentificationPref(eComStoreId, productIdentificationPref)
  } else {
    return await omsSetProductIdentificationPref(eComStoreId, productIdentificationPref)
  }
}

const setUserPreference = async (payload: any) => {
  if(SYSTEM_TYPE === "MOQUI") {
    return await maargUpdateUserPreference(payload)
  } else {
    return await omsSetUserPreference(payload)
  }
}
async function loginShopifyAppUser(baseURL: string, payload: any) {
  return await maargLoginShopifyAppUser(baseURL, payload);
}

async function setUserTimeZone(payload: any) {
  if (SYSTEM_TYPE === "MOQUI") {
    return await maargSetUserTimeZone(payload);
  } else {
    return await omsSetUserTimeZone(payload);
  }
}

async function setUserLocale(payload: any) {
  if (SYSTEM_TYPE === "MOQUI") {
    return await maargSetUserLocale(payload);
  } else {
    return await omsSetUserLocale(payload);
  }
}

export const userApi = { getProfile, logout, getAvailableTimeZones, getUserFacilities, getEComStoresByFacility, getEComStores, getProductIdentificationPref, getUserPreference, setProductIdentificationPref, setUserPreference, setUserLocale, setUserTimeZone }
