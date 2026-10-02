

const getFeatures = (productFeatures: any) => {
  const features = productFeatures
    ?.sort((firstFeature: string, secondFeature: string) => firstFeature.split('/')[0].localeCompare(secondFeature.split('/')[0]))
    ?.map((feature: string) => feature.substring(feature.indexOf("/") + 1)) // Not using split method as we may have features with value as `Size/N/S` and thus the only value returned is N when accessing 1st index considering that 1st index will have actual feature value, so we need to have some additional handling in case of split method
    ?.join(' ');
  return features || "";
}

const getFeature = (featureHierarchy: any, featureKey: string) => {
  let featureValue = ''
  if (featureHierarchy) {
    const feature = featureHierarchy.find((featureItem: any) => featureItem.startsWith(featureKey))
    const featureSplit = feature ? feature.split('/') : [];
    featureValue = featureSplit[2] ? featureSplit[2] : '';
  }
  return featureValue;
}

const getIdentificationId = (identifications: any, id: string) => {
  let externalId = ''
  if (identifications) {
    const externalIdentification = identifications.find((identification: any) => identification.startsWith(id))
    const externalIdentificationSplit = externalIdentification ? externalIdentification.split('/') : [];
    externalId = externalIdentificationSplit[1] ? externalIdentificationSplit[1] : '';
  }
  return externalId;
}

const getProductIdentificationValue = (productIdentifier: string, product: any) => {
  // handled this case as on page load initially the data is not available, so not to execute furthur code
  // untill product is not available
  if (!Object.keys(product).length) {
    return;
  }

  let value = product[productIdentifier]

  // goodIdentifications can be either strings ("type/value") or objects ({ type, value })
  const identification = product['goodIdentifications']?.find((identification: any) => {
    if (typeof identification === 'string') return identification.startsWith(productIdentifier + "/")
    return identification?.type === productIdentifier
  })

  if (identification) {
    value = typeof identification === 'string' ? identification.split('/')[1] : identification.value
  }

  return value;
}
export { getFeature, getFeatures, getIdentificationId, getProductIdentificationValue };
