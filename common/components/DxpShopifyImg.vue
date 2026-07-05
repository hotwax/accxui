<template>
  <img :src="imageUrl">
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import defaultImgUrl from "../assets/images/defaultImage.png"

const props = defineProps(['src', 'size']);
const imageUrl = ref(defaultImgUrl);

const checkIfImageExists = (src: string) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => reject(false);
    img.src = src;
  })
};

const isShopifyCdnUrl = computed(() => {
  if(!props.src) return false
  try {
    return new URL(props.src).hostname === "cdn.shopify.com"
  } catch {
    return false
  }
})

const prepareImgUrl = (src: string, size?: string) => {
  // return original size if no size is given
  if (!size || !isShopifyCdnUrl.value) return src

  // remove any current image size then add the new image size
  return src
    .replace(/_(pico|icon|thumb|small|compact|medium|large|grande|original|1024x1024|2048x2048|master)+\./g, '.')
    .replace(/\.jpg|\.png|\.gif|\.jpeg/g, function (match) {
      return '_' + size + match;
    })
};

const setImageUrl = () => {
  imageUrl.value = defaultImgUrl
  if (props.src) {
    const src: string = prepareImgUrl(props.src, props.size)
    checkIfImageExists(src).then(() => imageUrl.value = src).catch(err => console.error("checkIfImageExists", err))
  }
};

watch(() => [props.src, props.size], setImageUrl, { immediate: true });
</script>
