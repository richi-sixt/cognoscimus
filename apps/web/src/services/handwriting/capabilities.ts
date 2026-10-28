export type PenBackend = 'pointer' | 'none';

export interface CapabilityProbes {
  hasPointerEvents: boolean;
}

/** The single place that picks a pen backend. */
export const detectPenBackend = async (probes: CapabilityProbes): Promise<PenBackend> =>
  probes.hasPointerEvents ? 'pointer' : 'none';
