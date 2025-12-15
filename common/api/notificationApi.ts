import api from "../core/remoteApi";
import { hasError } from "../utils";
const SYSTEM_TYPE = import.meta.env.VITE_SYSTEM_TYPE || "OFBIZ";

async function omsGetNotificationEnumIds(enumTypeId: string): Promise<any> {
  const payload = {
    "inputFields": {
      enumTypeId
    },
    "entityName": "Enumeration",
    "fieldList": ["description", "enumId", "enumTypeId", "enumName"],
    "viewSize": 200
  }

  try {
    const resp = await api({
      url: "performFind",
      method: "get",
      params: payload
    }) as any

    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function omsGetNotificationUserPrefTypeIds(applicationId: string, userLoginId: string, filterConditions = {}): Promise<any> {
  const payload = {
    "inputFields": {
      "userPrefGroupTypeId": applicationId,
      userLoginId,
      ...filterConditions
    },
    "entityName": "UserPreference",
    "fieldList": ["userPrefTypeId", "userPrefGroupTypeId"],
    "viewSize": 200
  }

  try {
    const resp = await api({
      url: "performFind",
      method: "get",
      params: payload
    }) as any

    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function omsStoreClientRegistrationToken(registrationToken: string, deviceId: string, applicationId: string): Promise<any> {
  const payload = {
    registrationToken,
    deviceId,
    applicationId
  }

  try {
    const resp = await api({
      url: "service/storeClientRegistrationToken",
      method: "post",
      data: payload
    }) as any

    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function omsRemoveClientRegistrationToken(deviceId: string, applicationId: string): Promise<any> {
  const payload = {
    deviceId,
    applicationId
  }

  try {
    const resp = await api({
      url: "service/removeClientRegistrationToken",
      method: "post",
      data: payload
    }) as any


    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function omsSubscribeTopic(topicName: string, applicationId: string): Promise<any> {
  const payload = {
    topicName,
    applicationId
  }

  try {
    const resp = await api({
      url: "service/subscribeTopic",
      method: "post",
      data: payload
    }) as any

    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function omsUnsubscribeTopic(topicName: string, applicationId: string): Promise<any> {
  const payload = {
    topicName,
    applicationId
  }

  try {
    const resp = await api({
      url: "service/unsubscribeTopic",
      method: "post",
      data: payload
    }) as any

    if (!hasError(resp)) {
      return Promise.resolve(resp.data)
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

async function maargGetNotificationEnumIds(enumTypeId: string): Promise<any> {
  const params = {
    enumTypeId,
    pageSize: 200
  }

  try {
    const resp = await api({
      url: "admin/enums",
      method: "get",
      params
    }) as any;

    if (!hasError(resp)) {
      return Promise.resolve(resp.data);
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    });
  }
}

async function maargGetNotificationUserPrefTypeIds(applicationId: string, userId: string, filterConditions = {}): Promise<any> {
  const params = {
    topicTypeId: applicationId,
    userId,
    pageSize: 200,
    ...filterConditions
  }

  try {
    const resp = await api({
      url: "firebase/user/notificationtopic",
      method: "get",
      params
    }) as any;

    if (!hasError(resp)) {
      return Promise.resolve(resp.data);
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    });
  }
}

async function maargStoreClientRegistrationToken(registrationToken: string, deviceId: string, applicationId: string): Promise<any> {
  const payload = {
    registrationToken,
    deviceId,
    applicationId
  }

  try {
    const resp = await api({
      url: "firebase/token",
      method: "post",
      data: payload
    }) as any;

    if (!hasError(resp)) {
      return Promise.resolve(resp.data);
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    });
  }
}

async function maargRemoveClientRegistrationToken(deviceId: string, applicationId: string): Promise<any> {
  const params = {
    deviceId,
    applicationId
  }

  try {
    const resp = await api({
      url: "firebase/token",
      method: "delete",
      params
    }) as any;

    if (!hasError(resp)) {
      return Promise.resolve(resp.data);
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    });
  }
}

async function maargSubscribeTopic(topicName: string, applicationId: string): Promise<any> {
  const params = {
    topicName,
    applicationId
  }

  try {
    const resp = await api({
      url: "firebase/topic",
      method: "post",
      data: params
    }) as any;

    if (!hasError(resp)) {
      return Promise.resolve(resp.data);
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    });
  }
}

async function maargUnsubscribeTopic(topicName: string, applicationId: string): Promise<any> {
  const params = {
    topicName,
    applicationId
  }

  try {
    const resp = await api({
      url: "firebase/topic",
      method: "delete",
      data: params
    }) as any;

    if (!hasError(resp)) {
      return Promise.resolve(resp.data);
    } else {
      throw resp.data;
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    });
  }
}

async function getNotificationEnumIds(enumTypeId: string) {
  if (SYSTEM_TYPE === "MOQUI") {
    return await maargGetNotificationEnumIds(enumTypeId);
  } else {
    return await omsGetNotificationEnumIds(enumTypeId);
  }
}

// getNotificationUserPrefTypeIds
async function getNotificationUserPrefTypeIds(applicationId: string, userLoginId: string, filterConditions = {}) {
  if (SYSTEM_TYPE === "MOQUI") {
    return await maargGetNotificationUserPrefTypeIds(applicationId, userLoginId, filterConditions);
  } else {
    return await omsGetNotificationUserPrefTypeIds(applicationId, userLoginId, filterConditions);
  }
}

// storeClientRegistrationToken
async function storeClientRegistrationToken(registrationToken: string, deviceId: string, applicationId: string) {
  if (SYSTEM_TYPE === "MOQUI") {
    return await maargStoreClientRegistrationToken(registrationToken, deviceId, applicationId);
  } else {
    return await omsStoreClientRegistrationToken(registrationToken, deviceId, applicationId);
  }
}

// removeClientRegistrationToken
async function removeClientRegistrationToken(deviceId: string, applicationId: string) {
  if (SYSTEM_TYPE === "MOQUI") {
    return await maargRemoveClientRegistrationToken(deviceId, applicationId);
  } else {
    return await omsRemoveClientRegistrationToken(deviceId, applicationId);
  }
}

// subscribeTopic
async function subscribeTopic(topicName: string, applicationId: string) {
  if (SYSTEM_TYPE === "MOQUI") {
    return await maargSubscribeTopic(topicName, applicationId);
  } else {
    return await omsSubscribeTopic(topicName, applicationId);
  }
}

// unsubscribeTopic
async function unsubscribeTopic(topicName: string, applicationId: string) {
  if (SYSTEM_TYPE === "MOQUI") {
    return await maargUnsubscribeTopic(topicName, applicationId);
  } else {
    return await omsUnsubscribeTopic(topicName, applicationId);
  }
}

export const notificationApi = { getNotificationEnumIds, getNotificationUserPrefTypeIds, removeClientRegistrationToken, storeClientRegistrationToken, subscribeTopic, unsubscribeTopic };