import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_PROVIDER = 101;
const ERR_INVALID_DURATION = 102;
const ERR_INVALID_PREMIUM = 103;
const ERR_INVALID_COVERAGE = 104;
const ERR_INVALID_THRESHOLD = 105;
const ERR_CONTRACT_ALREADY_EXISTS = 106;
const ERR_CONTRACT_NOT_FOUND = 107;
const ERR_INVALID_CONTRACT_TYPE = 115;
const ERR_INVALID_INTEREST_RATE = 116;
const ERR_INVALID_GRACE_PERIOD = 117;
const ERR_INVALID_DEVICE_ID = 118;
const ERR_INVALID_CURRENCY = 119;
const ERR_INVALID_MIN_PREMIUM = 110;
const ERR_INVALID_MAX_COVERAGE = 111;
const ERR_MAX_CONTRACTS_EXCEEDED = 114;
const ERR_INVALID_UPDATE_PARAM = 113;
const ERR_AUTHORITY_NOT_VERIFIED = 109;

interface ServiceContract {
  owner: string;
  provider: string;
  startTime: number;
  duration: number;
  premiumAmount: number;
  coverageType: string;
  threshold: number;
  timestamp: number;
  contractType: string;
  interestRate: number;
  gracePeriod: number;
  deviceId: string;
  currency: string;
  status: boolean;
  minPremium: number;
  maxCoverage: number;
}

interface ContractUpdate {
  updateProvider: string;
  updateDuration: number;
  updatePremiumAmount: number;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ServiceContractFactoryMock {
  state: {
    nextContractId: number;
    maxContracts: number;
    creationFee: number;
    authorityContract: string | null;
    contracts: Map<number, ServiceContract>;
    contractUpdates: Map<number, ContractUpdate>;
    contractsByDevice: Map<string, number>;
  } = {
    nextContractId: 0,
    maxContracts: 1000,
    creationFee: 1000,
    authorityContract: null,
    contracts: new Map(),
    contractUpdates: new Map(),
    contractsByDevice: new Map(),
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
      nextContractId: 0,
      maxContracts: 1000,
      creationFee: 1000,
      authorityContract: null,
      contracts: new Map(),
      contractUpdates: new Map(),
      contractsByDevice: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
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

  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  createContract(
    provider: string,
    duration: number,
    premiumAmount: number,
    coverageType: string,
    threshold: number,
    contractType: string,
    interestRate: number,
    gracePeriod: number,
    deviceId: string,
    currency: string,
    minPremium: number,
    maxCoverage: number
  ): Result<number> {
    if (this.state.nextContractId >= this.state.maxContracts) return { ok: false, value: ERR_MAX_CONTRACTS_EXCEEDED };
    if (provider === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_PROVIDER };
    if (duration <= 0) return { ok: false, value: ERR_INVALID_DURATION };
    if (premiumAmount <= 0) return { ok: false, value: ERR_INVALID_PREMIUM };
    if (!coverageType || coverageType.length > 50) return { ok: false, value: ERR_INVALID_COVERAGE };
    if (threshold <= 0 || threshold > 100) return { ok: false, value: ERR_INVALID_THRESHOLD };
    if (!["basic", "premium", "enterprise"].includes(contractType)) return { ok: false, value: ERR_INVALID_CONTRACT_TYPE };
    if (interestRate > 20) return { ok: false, value: ERR_INVALID_INTEREST_RATE };
    if (gracePeriod > 30) return { ok: false, value: ERR_INVALID_GRACE_PERIOD };
    if (!deviceId || deviceId.length > 100) return { ok: false, value: ERR_INVALID_DEVICE_ID };
    if (!["STX", "USD", "BTC"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (minPremium <= 0) return { ok: false, value: ERR_INVALID_MIN_PREMIUM };
    if (maxCoverage <= 0) return { ok: false, value: ERR_INVALID_MAX_COVERAGE };
    if (!this.isVerifiedAuthority(this.caller).value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.contractsByDevice.has(deviceId)) return { ok: false, value: ERR_CONTRACT_ALREADY_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextContractId;
    const contract: ServiceContract = {
      owner: this.caller,
      provider,
      startTime: this.blockHeight,
      duration,
      premiumAmount,
      coverageType,
      threshold,
      timestamp: this.blockHeight,
      contractType,
      interestRate,
      gracePeriod,
      deviceId,
      currency,
      status: true,
      minPremium,
      maxCoverage,
    };
    this.state.contracts.set(id, contract);
    this.state.contractsByDevice.set(deviceId, id);
    this.state.nextContractId++;
    return { ok: true, value: id };
  }

  getContract(id: number): ServiceContract | null {
    return this.state.contracts.get(id) || null;
  }

  updateContract(id: number, updateProvider: string, updateDuration: number, updatePremiumAmount: number): Result<boolean> {
    const contract = this.state.contracts.get(id);
    if (!contract) return { ok: false, value: false };
    if (contract.owner !== this.caller) return { ok: false, value: false };
    if (updateProvider === "SP000000000000000000002Q6VF78") return { ok: false, value: false };
    if (updateDuration <= 0) return { ok: false, value: false };
    if (updatePremiumAmount <= 0) return { ok: false, value: false };

    const updated: ServiceContract = {
      ...contract,
      provider: updateProvider,
      duration: updateDuration,
      premiumAmount: updatePremiumAmount,
      timestamp: this.blockHeight,
    };
    this.state.contracts.set(id, updated);
    this.state.contractUpdates.set(id, {
      updateProvider,
      updateDuration,
      updatePremiumAmount,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  getContractCount(): Result<number> {
    return { ok: true, value: this.state.nextContractId };
  }

  checkContractExistence(deviceId: string): Result<boolean> {
    return { ok: true, value: this.state.contractsByDevice.has(deviceId) };
  }
}

describe("ServiceContractFactory", () => {
  let contract: ServiceContractFactoryMock;

  beforeEach(() => {
    contract = new ServiceContractFactoryMock();
    contract.reset();
  });

  it("creates a contract successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const svc = contract.getContract(0);
    expect(svc?.provider).toBe("ST3PROV");
    expect(svc?.duration).toBe(365);
    expect(svc?.premiumAmount).toBe(500);
    expect(svc?.coverageType).toBe("full");
    expect(svc?.threshold).toBe(80);
    expect(svc?.contractType).toBe("premium");
    expect(svc?.interestRate).toBe(5);
    expect(svc?.gracePeriod).toBe(14);
    expect(svc?.deviceId).toBe("DEV123");
    expect(svc?.currency).toBe("STX");
    expect(svc?.minPremium).toBe(100);
    expect(svc?.maxCoverage).toBe(10000);
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate device ids", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    const result = contract.createContract(
      "ST4PROV",
      730,
      1000,
      "basic",
      50,
      "basic",
      10,
      7,
      "DEV123",
      "USD",
      200,
      20000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONTRACT_ALREADY_EXISTS);
  });

  it("rejects non-authorized caller", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.caller = "ST2FAKE";
    contract.authorities = new Set();
    const result = contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV456",
      "STX",
      100,
      10000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects contract creation without authority contract", () => {
    const result = contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid duration", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createContract(
      "ST3PROV",
      0,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DURATION);
  });

  it("rejects invalid premium amount", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createContract(
      "ST3PROV",
      365,
      0,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PREMIUM);
  });

  it("rejects invalid contract type", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "invalid",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CONTRACT_TYPE);
  });

  it("updates a contract successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    const result = contract.updateContract(0, "ST4PROV", 730, 1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const svc = contract.getContract(0);
    expect(svc?.provider).toBe("ST4PROV");
    expect(svc?.duration).toBe(730);
    expect(svc?.premiumAmount).toBe(1000);
    const update = contract.state.contractUpdates.get(0);
    expect(update?.updateProvider).toBe("ST4PROV");
    expect(update?.updateDuration).toBe(730);
    expect(update?.updatePremiumAmount).toBe(1000);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent contract", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateContract(99, "ST4PROV", 730, 1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects update by non-owner", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    contract.caller = "ST3FAKE";
    const result = contract.updateContract(0, "ST4PROV", 730, 1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets creation fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setCreationFee(2000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.creationFee).toBe(2000);
    contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    expect(contract.stxTransfers).toEqual([{ amount: 2000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects creation fee change without authority contract", () => {
    const result = contract.setCreationFee(2000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct contract count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    contract.createContract(
      "ST4PROV",
      730,
      1000,
      "basic",
      50,
      "basic",
      10,
      7,
      "DEV456",
      "USD",
      200,
      20000
    );
    const result = contract.getContractCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks contract existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    const result = contract.checkContractExistence("DEV123");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.checkContractExistence("NONEXIST");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("parses contract parameters with Clarity types", () => {
    const deviceId = stringUtf8CV("DEV123");
    const duration = uintCV(365);
    const premiumAmount = uintCV(500);
    expect(deviceId.value).toBe("DEV123");
    expect(duration.value).toEqual(BigInt(365));
    expect(premiumAmount.value).toEqual(BigInt(500));
  });

  it("rejects contract creation with empty device id", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "",
      "STX",
      100,
      10000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DEVICE_ID);
  });

  it("rejects contract creation with max contracts exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxContracts = 1;
    contract.createContract(
      "ST3PROV",
      365,
      500,
      "full",
      80,
      "premium",
      5,
      14,
      "DEV123",
      "STX",
      100,
      10000
    );
    const result = contract.createContract(
      "ST4PROV",
      730,
      1000,
      "basic",
      50,
      "basic",
      10,
      7,
      "DEV456",
      "USD",
      200,
      20000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_CONTRACTS_EXCEEDED);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});