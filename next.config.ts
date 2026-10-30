import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist et les parseurs documentaires restent côté serveur :
  // ils ne doivent jamais être embarqués dans le bundle client.
  serverExternalPackages: ["pdfjs-dist", "mammoth", "xlsx", "adm-zip", "docx"],
  experimental: {
    // Les pièces d'un DCE pèsent parfois plusieurs dizaines de Mo.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
