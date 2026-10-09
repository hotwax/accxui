import { h, render } from "vue";

export default {
  mounted(el: HTMLElement, binding: any) {
    el.classList.add("pointer")

    const imageUrl = binding.value?.mainImageUrl;
    const productName = binding.value?.productName;

    const openModal = async () => {
      const { default: ImageModal } = await import("../components/ImageModal.vue");
      // The image the thumbnail already shows, so the modal can open on it while the full one loads.
      const thumbnail = el.querySelector("img")
      const previewUrl = thumbnail?.currentSrc || thumbnail?.getAttribute("src") || ""
      const container = document.createElement("div")
      el.appendChild(container)

      const vnode = h(ImageModal, {
        imageUrl,
        previewUrl,
        productName,
        onClose: () => {
          render(null, container)         // Unmount component
          el.removeChild(container)       // Remove from DOM
        }
        
      })

      render(vnode, container)
    };

    el.addEventListener('click', openModal);
  }
};
