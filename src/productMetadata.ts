import canonicalMetadata from '../product-metadata.json';

export const PRODUCT_METADATA = Object.freeze({
  ...canonicalMetadata,
  displayVersion: `Version ${canonicalMetadata.version}`,
  releaseLabel: `Version ${canonicalMetadata.version} — ${canonicalMetadata.releaseName}`,
  adifProgramId: canonicalMetadata.productId,
  adifProgramVersion: canonicalMetadata.version,
  userAgent: `${canonicalMetadata.productId}/${canonicalMetadata.version}`,
});

export function getProductUserAgent(integration?: string): string {
  return integration ? `${PRODUCT_METADATA.userAgent} (${integration})` : PRODUCT_METADATA.userAgent;
}

export function getVersionedDownloadFilename(extension = 'zip'): string {
  const safeExtension = extension.replace(/^\.+/, '');
  return `${PRODUCT_METADATA.productId}-${PRODUCT_METADATA.version}.${safeExtension}`;
}

export function getDiagnosticProductMetadata() {
  return {
    product: PRODUCT_METADATA.productName,
    version: PRODUCT_METADATA.version,
    release: PRODUCT_METADATA.releaseName,
  } as const;
}
