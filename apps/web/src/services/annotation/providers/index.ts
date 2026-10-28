import { AnnotationImportProvider } from '../types';

export type AnnotationProviderName = string;

// Register annotation import providers here.
const availableProviders: AnnotationImportProvider[] = [];

export const getAnnotationProvider = (
  name: AnnotationProviderName,
): AnnotationImportProvider | undefined => {
  return availableProviders.find((provider) => provider.name === name);
};

export const getAnnotationProviders = (): AnnotationImportProvider[] => {
  return availableProviders;
};
