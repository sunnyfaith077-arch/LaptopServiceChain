// tests/complaint-manager_test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_CONTRACT_ID = 101;
const ERR_INVALID_DESCRIPTION = 102;
const ERR_INVALID_STATUS = 103;
const ERR_COMPLAINT_ALREADY_EXISTS = 104;
const ERR_COMPLAINT_NOT_FOUND = 105;
const ERR_SEVERITY_INVALID = 107;
const ERR_INVALID_PRIORITY = 116;
const ERR_MAX_COMPLAINTS_EXCEEDED = 112;
const ERR_STATUS_TRANSITION_INVALID = 114;
const ERR_GRACE_PERIOD_EXPIRED = 115;
const ERR_DUPLICATE_ATTACHMENT = 111;

interface Complaint {
  contractId: number;
  description: string;
  status: string;
  timestamp: number;
  severity: string;
  priority: number;
  creator: string;
  attachments: string[];
  escalationLevel: number;
  resolutionNotes?: string;
  resolvedBy?: string;
}

interface ComplaintUpdate {
  updateStatus: string;
  updateTimestamp: number;
  updater: string;
  reason: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ComplaintManagerMock {
  state: {
    nextComplaintId: number;
    maxComplaintsPerContract: number;
    resolutionFee: number;
    authorityContract: string | null;
    gracePeriodBlocks: number;
    complaints: Map<number, Complaint>;
    complaintUpdates: Map<number, ComplaintUpdate>;
    complaintsByContract: Map<string, number>;
    contractComplaintCount: Map<number, number>;
  } = {
    nextComplaintId: 0,
    maxComplaintsPerContract: 50,
    resolutionFee: 5000,
    authorityContract: null,
    gracePeriodBlocks: 144,
    complaints: new Map(),
    complaintUpdates: new Map(),
    complaintsByContract: new Map(),
    contractComplaintCount: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextComplaintId: 0,
      maxComplaintsPerContract: 50,
      resolutionFee: 5000,
      authorityContract: null,
      gracePeriodBlocks: 144,
      complaints: new Map(),
      complaintUpdates: new Map(),
      complaintsByContract: new Map(),
      contractComplaintCount: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setResolutionFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.resolutionFee = newFee;
    return { ok: true, value: true };
  }

  setGracePeriod(newPeriod: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.gracePeriodBlocks = newPeriod;
    return { ok: true, value: true };
  }

  fileComplaint(
    contractId: number,
    description: string,
    severity: string,
    priority: number,
    attachments: string[]
  ): Result<number> {
    if (attachments.length >10) return { ok: false, value: ERR_INVALID_CONTRACT_ID };
    if (this.state.nextComplaintId >= this.state.maxComplaintsPerContract * 10) return { ok: false, value: ERR_MAX_COMPLAINTS_EXCEEDED };
    if (description.length <5 || description.length > 256) return { ok: false, value: ERR_INVALID_DESCRIPTION };
    if (!["low", "medium", "high"].includes(severity)) return { ok: false, value: ERR_SEVERITY_INVALID };
    if (priority > 5) return { ok: false, value: ERR_INVALID_PRIORITY };
    attachments.forEach(att => {
      if (att.length === 0 || att.length > 128) return { ok: false, value: ERR_INVALID_CONTRACT_ID };
    });
    if (!this.authorities.has(this.caller)) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const descHash = Buffer.from(description + contractId.toString()).toString("hex");
    const key = `${contractId}-${descHash}`;
    if (this.state.complaintsByContract.has(key)) return { ok: false, value: ERR_COMPLAINT_ALREADY_EXISTS };
    const contractCount = this.state.contractComplaintCount.get(contractId) || 0;
    if (contractCount >= this.state.maxComplaintsPerContract) return { ok: false, value: ERR_MAX_COMPLAINTS_EXCEEDED };

    this.state.complaintsByContract.set(key, this.state.nextComplaintId);
    this.state.contractComplaintCount.set(contractId, contractCount + 1);

    const id = this.state.nextComplaintId;
    const complaint: Complaint = {
      contractId,
      description,
      status: "pending",
      timestamp: this.blockHeight,
      severity,
      priority,
      creator: this.caller,
      attachments,
      escalationLevel: 0,
    };
    this.state.complaints.set(id, complaint);
    this.state.nextComplaintId++;
    return { ok: true, value: id };
  }

  getComplaint(id: number): Complaint | null {
    return this.state.complaints.get(id) || null;
  }

  updateComplaintStatus(id: number, newStatus: string, reason: string): Result<boolean> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) return { ok: false, value: false };
    if (complaint.creator !== this.caller) return { ok: false, value: false };
    if (!["pending", "monitoring", "escalated", "resolved", "closed"].includes(newStatus)) return { ok: false, value: ERR_INVALID_STATUS };
    const transitions: { [key: string]: string[] } = {
      pending: ["monitoring"],
      monitoring: ["escalated"],
      escalated: ["resolved"],
      resolved: ["closed"],
    };
    if (!transitions[complaint.status]?.includes(newStatus)) return { ok: false, value: ERR_STATUS_TRANSITION_INVALID };
    if ((this.blockHeight - complaint.timestamp) > this.state.gracePeriodBlocks) return { ok: false, value: ERR_GRACE_PERIOD_EXPIRED };

    if (newStatus === "resolved") {
      if (!this.state.authorityContract) return { ok: false, value: false };
      this.stxTransfers.push({ amount: this.state.resolutionFee, from: this.caller, to: this.state.authorityContract });
      complaint.resolutionNotes = reason;
      complaint.resolvedBy = this.caller;
    }
    complaint.status = newStatus;
    this.state.complaints.set(id, complaint);
    this.state.complaintUpdates.set(id, {
      updateStatus: newStatus,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
      reason,
    });
    return { ok: true, value: true };
  }

  addAttachment(id: number, attachment: string): Result<boolean> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) return { ok: false, value: false };
    if (complaint.creator !== this.caller) return { ok: false, value: false };
    if (attachment.length === 0 || attachment.length > 128) return { ok: false, value: false };
    if (complaint.attachments.includes(attachment)) return { ok: false, value: ERR_DUPLICATE_ATTACHMENT };
    if (complaint.attachments.length >= 10) return { ok: false, value: false };
    complaint.attachments.push(attachment);
    this.state.complaints.set(id, complaint);
    return { ok: true, value: true };
  }

  escalateComplaint(id: number): Result<boolean> {
    const complaint = this.state.complaints.get(id);
    if (!complaint) return { ok: false, value: false };
    if (complaint.status !== "monitoring") return { ok: false, value: ERR_STATUS_TRANSITION_INVALID };
    if (complaint.escalationLevel >= 3) return { ok: false, value: false };
    complaint.status = "escalated";
    complaint.escalationLevel += 1;
    this.state.complaints.set(id, complaint);
    return { ok: true, value: true };
  }

  getComplaintCount(): Result<number> {
    return { ok: true, value: this.state.nextComplaintId };
  }

  checkComplaintExistence(contractId: number, description: string): Result<boolean> {
    const descHash = Buffer.from(description + contractId.toString()).toString("hex");
    const key = `${contractId}-${descHash}`;
    return { ok: true, value: this.state.complaintsByContract.has(key) };
  }
}

describe("ComplaintManager", () => {
  let contract: ComplaintManagerMock;

  beforeEach(() => {
    contract = new ComplaintManagerMock();
    contract.reset();
  });

  it("files a complaint successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.fileComplaint(
      1,
      "Laptop screen flickering",
      "high",
      3,
      ["photo1.jpg"]
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const complaint = contract.getComplaint(0);
    expect(complaint?.description).toBe("Laptop screen flickering");
    expect(complaint?.severity).toBe("high");
    expect(complaint?.priority).toBe(3);
    expect(complaint?.attachments).toEqual(["photo1.jpg"]);
    expect(contract.state.contractComplaintCount.get(1)).toBe(1);
  });

  it("rejects duplicate complaints", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Laptop screen flickering", "high", 3, ["photo1.jpg"]);
    const result = contract.fileComplaint(1, "Laptop screen flickering", "medium", 2, ["photo2.jpg"]);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_COMPLAINT_ALREADY_EXISTS);
  });

  it("rejects non-authorized caller", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.caller = "ST2FAKE";
    contract.authorities = new Set();
    const result = contract.fileComplaint(1, "Valid long description", "low", 1, []);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects max complaints per contract", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxComplaintsPerContract = 1;
    contract.fileComplaint(1, "First long description", "low", 1, []);
    const result = contract.fileComplaint(1, "Second long description", "low", 1, []);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_COMPLAINTS_EXCEEDED);
  });

  it("rejects invalid description", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.fileComplaint(1, "A", "low", 1, []);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DESCRIPTION);
  });

  it("rejects invalid severity", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.fileComplaint(1, "Valid long description", "invalid", 1, []);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SEVERITY_INVALID);
  });

  it("updates complaint status successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Valid long description", "low", 1, []);
    const result = contract.updateComplaintStatus(0, "monitoring", "Initial check");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const complaint = contract.getComplaint(0);
    expect(complaint?.status).toBe("monitoring");
    const update = contract.state.complaintUpdates.get(0);
    expect(update?.updateStatus).toBe("monitoring");
    expect(update?.reason).toBe("Initial check");
  });

  it("resolves complaint with fee transfer", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Valid long description", "low", 1, []);
    contract.updateComplaintStatus(0, "monitoring", "Checked");
    contract.updateComplaintStatus(0, "escalated", "Escalated");
    contract.blockHeight = 10;
    const result = contract.updateComplaintStatus(0, "resolved", "Fixed remotely");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const complaint = contract.getComplaint(0);
    expect(complaint?.status).toBe("resolved");
    expect(complaint?.resolutionNotes).toBe("Fixed remotely");
    expect(complaint?.resolvedBy).toBe("ST1TEST");
    expect(contract.stxTransfers).toEqual([{ amount: 5000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects invalid status transition", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Valid long description", "low", 1, []);
    const result = contract.updateComplaintStatus(0, "closed", "Direct close");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STATUS_TRANSITION_INVALID);
  });

  it("rejects grace period expired", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Valid long description", "low", 1, []);
    contract.blockHeight = 200;
    contract.state.gracePeriodBlocks = 144;
    const result = contract.updateComplaintStatus(0, "monitoring", "Late update");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_GRACE_PERIOD_EXPIRED);
  });

  it("adds attachment successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Valid long description", "low", 1, []);
    const result = contract.addAttachment(0, "new-photo.jpg");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const complaint = contract.getComplaint(0);
    expect(complaint?.attachments).toEqual(expect.arrayContaining(["new-photo.jpg"]));
  });

  it("rejects duplicate attachment", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Valid long description", "low", 1, ["photo.jpg"]);
    const result = contract.addAttachment(0, "photo.jpg");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_DUPLICATE_ATTACHMENT);
  });

  it("escalates complaint successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Valid long description", "low", 1, []);
    contract.updateComplaintStatus(0, "monitoring", "Check done");
    const result = contract.escalateComplaint(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const complaint = contract.getComplaint(0);
    expect(complaint?.status).toBe("escalated");
    expect(complaint?.escalationLevel).toBe(1);
  });

  it("rejects escalation not allowed", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Valid long description", "low", 1, []);
    const result = contract.escalateComplaint(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STATUS_TRANSITION_INVALID);
  });

  it("sets resolution fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setResolutionFee(10000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.resolutionFee).toBe(10000);
  });

  it("returns correct complaint count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "First long description", "low", 1, []);
    contract.fileComplaint(2, "Second long description", "medium", 2, []);
    const result = contract.getComplaintCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks complaint existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.fileComplaint(1, "Valid long description", "low", 1, []);
    const result = contract.checkComplaintExistence(1, "Valid long description");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.checkComplaintExistence(1, "NonExistent");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("parses complaint parameters with Clarity types", () => {
    const desc = stringUtf8CV("Test desc");
    const sev = stringUtf8CV("low");
    const pri = uintCV(1);
    expect(desc.value).toBe("Test desc");
    expect(sev.value).toBe("low");
    expect(pri.value).toEqual(BigInt(1));
  });

  it("rejects file with too many attachments", () => {
    contract.setAuthorityContract("ST2TEST");
    const manyAtts = Array(11).fill("att.jpg");
    const result = contract.fileComplaint(1, "Valid long description", "low", 1, manyAtts);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CONTRACT_ID);
  });
});