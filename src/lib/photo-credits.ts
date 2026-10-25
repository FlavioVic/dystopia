/**
 * Fotos reais de produto — Wikimedia Commons, licenças livres (CC0, CC BY,
 * CC BY-SA). Só entra foto do MODELO EXATO vendido; sem foto exata, o produto
 * fica com a placa técnica gerada (`npm run art`). A licença exige crédito:
 * a legenda na página do produto e /creditos leem daqui.
 */

export type PhotoCredit = {
  file: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
};

export const PRODUCT_PHOTOS: Record<string, PhotoCredit> = {
  "geforce-rtx-5080-16gb": {
    file: "/images/photos/geforce-rtx-5080-16gb.webp",
    title: "RTX 5080.png",
    author: "XD7006",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0",
    source: "https://commons.wikimedia.org/wiki/File:RTX_5080.png",
  },
  "geforce-rtx-5060-8gb": {
    file: "/images/photos/geforce-rtx-5060-8gb.webp",
    title: "PNY RTX 5060 at Computex 2025.jpg",
    author: "4300streetcar",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0",
    source: "https://commons.wikimedia.org/wiki/File:PNY_RTX_5060_at_Computex_2025.jpg",
  },
  "radeon-rx-9070-xt-16gb": {
    file: "/images/photos/radeon-rx-9070-xt-16gb.webp",
    title: "Sapphire Pulse Radeon RX 9070 XT - Lüfter 1.jpg",
    author: "Chaddy",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    source: "https://commons.wikimedia.org/wiki/File:Sapphire_Pulse_Radeon_RX_9070_XT_-_L%C3%BCfter_1.jpg",
  },
  "ryzen-5-9600x": {
    file: "/images/photos/ryzen-5-9600x.webp",
    title: "AMD@4nmCCD(6nmIOD)@Zen5@Granite Ridge@Ryzen 5 9600X@100-000001405 BY 2429SUY 9AEQ579S40073 DSC01876.jpg",
    author: "FritzchensFritz",
    license: "CC0",
    licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
    source: "https://commons.wikimedia.org/wiki/File:AMD@4nmCCD(6nmIOD)@Zen5@Granite_Ridge@Ryzen_5_9600X@100-000001405_BY_2429SUY_9AEQ579S40073_DSC01876.jpg",
  },
  "ssd-990-pro-nvme": {
    file: "/images/photos/ssd-990-pro-nvme.webp",
    title: "SAMSUNG M.2 NVMe SSD 990 PRO 4TB.jpg",
    author: "Dinkun Chen",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    source: "https://commons.wikimedia.org/wiki/File:SAMSUNG_M.2_NVMe_SSD_990_PRO_4TB.jpg",
  },
  "wd-black-sn850x-1tb": {
    file: "/images/photos/wd-black-sn850x-1tb.webp",
    title: "Western Digital SN850X NVME solid state drive 8TB front side.jpg",
    author: "4300streetcar",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0",
    source: "https://commons.wikimedia.org/wiki/File:Western_Digital_SN850X_NVME_solid_state_drive_8TB_front_side.jpg",
  },
  "deepcool-ak400": {
    file: "/images/photos/deepcool-ak400.webp",
    title: "DeepCool AK400 1.jpg",
    author: "Qurren",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    source: "https://commons.wikimedia.org/wiki/File:DeepCool_AK400_1.jpg",
  },
  "logitech-g-pro-x-superlight-2": {
    file: "/images/photos/logitech-g-pro-x-superlight-2.webp",
    title: "Logitech Pro X Superlight 2 sample 20231216.jpg",
    author: "Solomon203",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    source: "https://commons.wikimedia.org/wiki/File:Logitech_Pro_X_Superlight_2_sample_20231216.jpg",
  },
};

/** Crédito de uma imagem pela URL (a mesma que vai em product_images.url). */
export function photoCreditByUrl(url: string): PhotoCredit | undefined {
  return Object.values(PRODUCT_PHOTOS).find((p) => p.file === url);
}
