/**
 * Boundary for optional booking audit proofs.
 *
 * Only a hash commitment ever leaves our infrastructure: the proof is
 * sha256 over a per-booking random salt (kept off-chain) plus a canonical
 * booking record that excludes personal data. The salt stops anyone guessing
 * a booking from its hash. Names, phone numbers, emails, licence plates,
 * credentials and any CCTV footage or frames are never written on-chain, in
 * calldata or in event logs.
 */
export interface BookingProofRequest {
  bookingId: string;
  /** Hex sha256 of salt + canonical, PII-free booking record. */
  commitment: string;
}

export interface BookingProofReceipt {
  chainId: number;
  txHash: string;
  /** Block confirmations at the time of the check; 0 means submitted but not mined. */
  confirmations: number;
}

export interface BookingProofService {
  readonly name: "web3";
  anchor(request: BookingProofRequest): Promise<BookingProofReceipt>;
  verify(bookingId: string, commitment: string): Promise<{ anchored: boolean; receipt?: BookingProofReceipt }>;
}
