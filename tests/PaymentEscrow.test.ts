// tests/payment-escrow.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV, listCV, noneCV, someCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AMOUNT = 101;
const ERR_INVALID_PAYEE = 102;
const ERR_INVALID_TIMEOUT = 103;
const ERR_ESCROW_NOT_FOUND = 104;
const ERR_ALREADY_RELEASED = 105;
const ERR_DISPUTE_ACTIVE = 106;
const ERR_VOTING_NOT_ENDED = 107;
const ERR_INSUFFICIENT_VOTES = 108;
const ERR_INVALID_VOTE = 109;
const ERR_TIMEOUT_EXPIRED = 110;
const ERR_INVALID_ESCROW_TYPE = 111;
const ERR_MAX_ESCROWS_EXCEEDED = 112;
const ERR_FEE_INSUFFICIENT = 113;

interface Escrow {
  payer: string;
  payee: string;
  amount: number;
  timeout: number;
  status: string;
  timestamp: number;
  escrowType: string;
  disputeId?: number | null;
  votesForRelease: number;
  votesForRefund: number;
  voters: string[];
}

interface Dispute {
  escrowId: number;
  description: string;
  raisedBy: string;
  raisedAt: number;
  resolved: boolean;
  resolution: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class PaymentEscrowMock {
  state: {
    nextEscrowId: number;
    maxEscrows: number;
    escrowFee: number;
    authorityContract: string | null;
    defaultTimeout: number;
    escrows: Map<number, Escrow>;
    disputes: Map<number, Dispute>;
    escrowFeesCollected: Map<string, number>;
  } = {
    nextEscrowId: 0,
    maxEscrows: 500,
    escrowFee: 500,
    authorityContract: null,
    defaultTimeout: 144,
    escrows: new Map(),
    disputes: new Map(),
    escrowFeesCollected: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string | null; memo?: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextEscrowId: 0,
      maxEscrows: 500,
      escrowFee: 500,
      authorityContract: null,
      defaultTimeout: 144,
      escrows: new Map(),
      disputes: new Map(),
      escrowFeesCollected: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMaxEscrows(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.maxEscrows = newMax;
    return { ok: true, value: true };
  }

  setEscrowFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.escrowFee = newFee;
    return { ok: true, value: true };
  }

  setDefaultTimeout(newTimeout: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.defaultTimeout = newTimeout;
    return { ok: true, value: true };
  }

  createEscrow(
    payee: string,
    amount: number,
    customTimeout?: number | null,
    escrowType: string
  ): Result<number> {
    if (this.state.nextEscrowId >= this.state.maxEscrows) return { ok: false, value: ERR_MAX_ESCROWS_EXCEEDED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (payee === this.caller) return { ok: false, value: ERR_INVALID_PAYEE };
    const timeout = customTimeout || this.state.defaultTimeout;
    if (timeout <= 0) return { ok: false, value: ERR_INVALID_TIMEOUT };
    if (!["service", "dispute", "timelock"].includes(escrowType)) return { ok: false, value: ERR_INVALID_ESCROW_TYPE };
    if (!this.state.authorityContract) return { ok: false, value: ERR_NOT_AUTHORIZED };

    const totalAmount = amount + this.state.escrowFee;
    this.stxTransfers.push({ amount: totalAmount, from: this.caller, to: "contract" });
    this.stxTransfers.push({ amount: this.state.escrowFee, from: this.caller, to: this.state.authorityContract });

    const escrowFees = this.state.escrowFeesCollected.get(this.state.authorityContract) || 0;
    this.state.escrowFeesCollected.set(this.state.authorityContract, escrowFees + this.state.escrowFee);

    const id = this.state.nextEscrowId;
    const escrow: Escrow = {
      payer: this.caller,
      payee,
      amount,
      timeout: this.blockHeight + timeout,
      status: "active",
      timestamp: this.blockHeight,
      escrowType,
      disputeId: null,
      votesForRelease: 0,
      votesForRefund: 0,
      voters: [],
    };
    this.state.escrows.set(id, escrow);
    this.stxTransfers.push({ amount, from: this.caller, to: "contract", memo: "Escrow deposit" });
    this.state.nextEscrowId++;
    return { ok: true, value: id };
  }

  getEscrow(id: number): Escrow | null {
    return this.state.escrows.get(id) || null;
  }

  releaseEscrow(escrowId: number): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: false };
    if (escrow.status !== "active") return { ok: false, value: false };
    if (this.blockHeight > escrow.timeout) return { ok: false, value: ERR_TIMEOUT_EXPIRED };
    if (escrow.payee !== this.caller) return { ok: false, value: false };
    this.stxTransfers.push({ amount: escrow.amount, from: "contract", to: escrow.payee });
    escrow.status = "released";
    return { ok: true, value: true };
  }

  refundEscrow(escrowId: number): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: false };
    if (escrow.status !== "active") return { ok: false, value: false };
    if (this.blockHeight <= escrow.timeout) return { ok: false, value: false };
    if (escrow.payer !== this.caller) return { ok: false, value: false };
    this.stxTransfers.push({ amount: escrow.amount, from: "contract", to: escrow.payer });
    escrow.status = "refunded";
    return { ok: true, value: true };
  }

  raiseDispute(escrowId: number, description: string): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: false };
    if (escrow.status !== "active") return { ok: false, value: ERR_DISPUTE_ACTIVE };
    if (escrow.payer !== this.caller && escrow.payee !== this.caller) return { ok: false, value: false };
    escrow.status = "disputed";
    escrow.disputeId = this.state.nextEscrowId;
    const disputeId = this.state.nextEscrowId;
    this.state.disputes.set(disputeId, {
      escrowId,
      description,
      raisedBy: this.caller,
      raisedAt: this.blockHeight,
      resolved: false,
      resolution: "",
    });
    this.state.nextEscrowId++;
    return { ok: true, value: true };
  }

  voteOnDispute(escrowId: number, voteForRelease: boolean): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: false };
    if (!escrow.disputeId) return { ok: false, value: false };
    const disputeId = escrow.disputeId;
    const dispute = this.state.disputes.get(disputeId);
    if (!dispute) return { ok: false, value: false };
    if (escrow.voters.includes(this.caller)) return { ok: false, value: ERR_INVALID_VOTE };
    if (escrow.status !== "disputed") return { ok: false, value: ERR_DISPUTE_ACTIVE };
    escrow.voters.push(this.caller);
    if (voteForRelease) {
      escrow.votesForRelease++;
    } else {
      escrow.votesForRefund++;
    }
    if (this.blockHeight > dispute.raisedAt + 288) {
      return this.resolveDispute(escrowId);
    }
    return { ok: true, value: true };
  }

  private resolveDispute(escrowId: number): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow || !escrow.disputeId) return { ok: false, value: false };
    const dispute = this.state.disputes.get(escrow.disputeId);
    if (!dispute) return { ok: false, value: false };
    const totalVotes = escrow.votesForRelease + escrow.votesForRefund;
    if (totalVotes <= 0) return { ok: false, value: ERR_INSUFFICIENT_VOTES };
    const releasePerc = (escrow.votesForRelease * 100) / totalVotes;
    if (releasePerc > 50) {
      this.stxTransfers.push({ amount: escrow.amount, from: "contract", to: escrow.payee });
      escrow.status = "released";
      dispute.resolved = true;
      dispute.resolution = "release";
    } else {
      this.stxTransfers.push({ amount: escrow.amount, from: "contract", to: escrow.payer });
      escrow.status = "refunded";
      dispute.resolved = true;
      dispute.resolution = "refund";
    }
    return { ok: true, value: true };
  }

  getEscrowCount(): Result<number> {
    return { ok: true, value: this.state.nextEscrowId };
  }

  withdrawFees(principal: string): Result<number> {
    const fees = this.state.escrowFeesCollected.get(principal) || 0;
    if (!this.state.authorityContract || principal !== this.state.authorityContract) return { ok: false, value: 0 };
    if (fees <= 0) return { ok: false, value: 0 };
    this.stxTransfers.push({ amount: fees, from: "contract", to: principal });
    this.state.escrowFeesCollected.set(principal, 0);
    return { ok: true, value: fees };
  }
}

describe("PaymentEscrow", () => {
  let contract: PaymentEscrowMock;

  beforeEach(() => {
    contract = new PaymentEscrowMock();
    contract.reset();
  });

  it("creates an escrow successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createEscrow("ST3TEST", 1000, null, "service");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const escrow = contract.getEscrow(0);
    expect(escrow?.payer).toBe("ST1TEST");
    expect(escrow?.payee).toBe("ST3TEST");
    expect(escrow?.amount).toBe(1000);
    expect(escrow?.timeout).toBe(144);
    expect(escrow?.status).toBe("active");
    expect(escrow?.escrowType).toBe("service");
    expect(contract.stxTransfers.length).toBe(3);
    expect(contract.stxTransfers[2].memo).toBe("Escrow deposit");
  });

  it("rejects escrow creation with invalid amount", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createEscrow("ST3TEST", 0, null, "service");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects escrow creation with self as payee", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createEscrow("ST1TEST", 1000, null, "service");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PAYEE);
  });

  it("rejects escrow creation with invalid type", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createEscrow("ST3TEST", 1000, null, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ESCROW_TYPE);
  });

  it("rejects escrow creation without authority", () => {
    const result = contract.createEscrow("ST3TEST", 1000, null, "service");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("releases escrow successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, 10, "service");
    contract.caller = "ST3TEST";
    const result = contract.releaseEscrow(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("released");
    expect(contract.stxTransfers.length).toBe(4);
  });

  it("rejects release by non-payee", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, 10, "service");
    const result = contract.releaseEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects release after timeout", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, 10, "service");
    contract.blockHeight = 151;
    contract.caller = "ST3TEST";
    const result = contract.releaseEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_TIMEOUT_EXPIRED);
  });

  it("refunds escrow after timeout", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, 10, "service");
    contract.blockHeight = 151;
    contract.caller = "ST1TEST";
    const result = contract.refundEscrow(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("refunded");
  });

  it("rejects refund before timeout", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, 10, "service");
    const result = contract.refundEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("raises dispute successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, null, "dispute");
    const result = contract.raiseDispute(0, "Service issue");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("disputed");
    expect(escrow?.disputeId).toBe(1);
    const dispute = contract.state.disputes.get(1);
    expect(dispute?.description).toBe("Service issue");
  });

  it("rejects dispute by unauthorized", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, null, "dispute");
    contract.caller = "ST4FAKE";
    const result = contract.raiseDispute(0, "Issue");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("votes on dispute successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, null, "dispute");
    contract.raiseDispute(0, "Issue");
    contract.caller = "ST1TEST";
    const result = contract.voteOnDispute(0, true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.votesForRelease).toBe(1);
    expect(escrow?.voters).toEqual(["ST1TEST"]);
  });

  it("resolves dispute after voting period with majority release", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, null, "dispute");
    contract.raiseDispute(0, "Issue");
    contract.blockHeight = 300;
    contract.caller = "ST1TEST";
    contract.voteOnDispute(0, true);
    contract.caller = "ST4VOTER";
    contract.voteOnDispute(0, true);
    contract.caller = "ST5VOTER";
    contract.voteOnDispute(0, false);
    const result = contract.resolveDispute(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("released");
  });

  it("resolves dispute with majority refund", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, null, "dispute");
    contract.raiseDispute(0, "Issue");
    contract.blockHeight = 300;
    contract.caller = "ST1TEST";
    contract.voteOnDispute(0, false);
    contract.caller = "ST4VOTER";
    contract.voteOnDispute(0, false);
    contract.caller = "ST5VOTER";
    contract.voteOnDispute(0, true);
    const result = contract.resolveDispute(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("refunded");
  });

  it("rejects resolution with insufficient votes", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, null, "dispute");
    contract.raiseDispute(0, "Issue");
    contract.blockHeight = 300;
    const result = contract.resolveDispute(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_VOTES);
  });

  it("withdraws fees successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, null, "service");
    contract.createEscrow("ST4TEST", 2000, null, "service");
    contract.caller = "ST2TEST";
    const result = contract.withdrawFees("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
    expect(contract.stxTransfers.length).toBe(7);
  });

  it("rejects fee withdrawal by unauthorized", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, null, "service");
    contract.caller = "ST1TEST";
    const result = contract.withdrawFees("ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(0);
  });

  it("returns correct escrow count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST3TEST", 1000, null, "service");
    contract.createEscrow("ST4TEST", 2000, null, "service");
    const result = contract.getEscrowCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("rejects max escrows exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxEscrows = 1;
    contract.createEscrow("ST3TEST", 1000, null, "service");
    const result = contract.createEscrow("ST4TEST", 2000, null, "service");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_ESCROWS_EXCEEDED);
  });

  it("uses custom timeout", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createEscrow("ST3TEST", 1000, 50, "timelock");
    expect(result.ok).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.timeout).toBe(50);
  });
});