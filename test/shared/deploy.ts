import { ethers } from "hardhat";
import { deployContract as deployContractFromBytecode } from "ethereum-waffle";
import { TestERC20 } from "../../typechain/TestERC20";
import { IWETH9 } from "../../typechain";

import WETH9 from "../contracts/WETH9.json";

const deployContract = async (
  contract: string,
  libraries: any,
  ...args: any[]
) => {
  let instance;
  const factory = await ethers.getContractFactory(contract, { libraries });
  instance = await factory.deploy(...args);
  await instance.deployed();
  return instance;
};

export const deployWETH9 = async (wallet: any) => {
  const weth9 = (await deployContractFromBytecode(wallet, {
    bytecode: WETH9.bytecode,
    abi: WETH9.abi,
  })) as IWETH9;

  return weth9;
};
export const deployPoolInspector = async () => {
  return (await deployContract("PoolInspector", null)) as any;
};

export const deployRouter = async ({ factory, weth9 }: any) => {
  const swapRouter = (await deployContract(
    "Router",
    {},
    factory,
    weth9
  )) as any;
  return swapRouter;
};

export const deploySlimRouter = async ({ factory, weth9 }: any) => {
  const swapRouter = (await deployContract("SlimRouter", {}, factory, weth9, {
    gasPrice: 500,
  })) as any;
  return swapRouter;
};

export const deployPositionMetadata = async () => {
  const position = (await deployContract("PositionMetadata", {}, "")) as any;
  return position;
};

export const deployPosition = async () => {
  const position = (await deployContract(
    "Position",
    {},
    (
      await deployPositionMetadata()
    ).address
  )) as any;
  return position;
};

export const deployDeployer = async () => {
  const deployer = (await deployContract("Deployer", {})) as any;
  return deployer;
};

export const deployFactory = async ({ protocolFeeRatio, position }: any) => {
  const factory = (await deployContract(
    "Factory",
    {
      Deployer: (await deployDeployer()).address,
    },
    protocolFeeRatio,
    position
  )) as any;
  return factory;
};

export const deployERC20Token = async ({
  name = "Test",
  symbol = "TKN",
  decimals = 18,
}: any = {}) => {
  return (await deployContract(
    "TestERC20",
    {},
    name,
    symbol,
    decimals
  )) as TestERC20;
};
