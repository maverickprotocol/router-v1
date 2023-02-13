import { ethers } from "hardhat";
import { expect, use } from "chai";
import { constants, Signer, BigNumber } from "ethers";
import chaiAsPromised from "chai-as-promised";

import {
  Factory,
  Position,
  SlimRouter as Router,
  Router as FatRouter,
  TestERC20,
  IWETH9,
  IERC20,
  PoolInspector,
  Pool__factory,
} from "../typechain";

import {
  deployERC20Token,
  deployPosition,
  deployFactory,
  deploySlimRouter as deployRouter,
  deployRouter as deployFatRouter,
  deployPoolInspector,
  deployWETH9,
} from "./shared/deploy";

import { fixedToFloat, floatToFixed, encodePath } from "./shared/utils";

use(chaiAsPromised);

describe("SlimRouter", () => {
  let owner: Signer;
  let addr1: Signer;
  let tokenA: TestERC20;
  let tokenB: TestERC20;
  let position: Position;
  let factory: Factory;
  let poolInspector: PoolInspector;
  let router: Router;
  let fatRouter: FatRouter;
  let weth9: IWETH9;
  let maxDeadline: number = 1e13;
  let tickSpacing: bigint = BigInt(
    Math.floor(Math.log(1.1) / Math.log(1.0001))
  );
  let lookback: BigInt = BigInt(3600e18);
  let getPool: (
    _fee: number,
    token0: IERC20,
    token1: IERC20,
    amount0: number,
    amount1: number,
    _lookback: number
  ) => Promise<string>;
  let getEthBPool: (
    _fee: number,
    amount: number,
    _lookback: number
  ) => Promise<string>;
  let balances: (address_: string) => Promise<{
    tokenA: number;
    tokenB: number;
    weth9: number;
  }>;
  let ethBalances: () => Promise<{
    router: number;
    owner: number;
  }>;
  let tokenId = 1;

  beforeEach(async () => {
    [owner, addr1] = await ethers.getSigners();
    tokenA = await deployERC20Token({ symbol: "TokenA" });
    tokenB = await deployERC20Token({ symbol: "TokenB" });

    let tokenAtemp =
      BigNumber.from(tokenA.address).toBigInt() <
      BigNumber.from(tokenB.address).toBigInt()
        ? tokenA
        : tokenB;
    tokenB =
      BigNumber.from(tokenA.address).toBigInt() <
      BigNumber.from(tokenB.address).toBigInt()
        ? tokenB
        : tokenA;
    tokenA = tokenAtemp;

    weth9 = await deployWETH9(owner);

    balances = async (address_) => {
      return {
        tokenA: fixedToFloat(await tokenA.balanceOf(address_)),
        tokenB: fixedToFloat(await tokenB.balanceOf(address_)),
        weth9: fixedToFloat(await weth9.balanceOf(address_)),
      };
    };

    position = await deployPosition();
    poolInspector = await deployPoolInspector();
    factory = await deployFactory({
      protocolFeeRatio: 0.25 * 1000,
      lookback: 60 * 60,
      position: position.address,
    });

    router = await deployRouter({
      factory: factory.address,
      weth9: weth9.address,
    });
    fatRouter = await deployFatRouter({
      factory: factory.address,
      weth9: weth9.address,
    });
    ethBalances = async () => {
      return {
        router: fixedToFloat(await ethers.provider.getBalance(router.address)),
        owner: fixedToFloat(await owner.getBalance()),
      };
    };

    await tokenA.mint(await owner.getAddress(), floatToFixed(3000));
    await tokenA.approve(router.address, floatToFixed(3000));
    await tokenA.approve(fatRouter.address, floatToFixed(3000));
    await tokenB.mint(await owner.getAddress(), floatToFixed(3000));
    await tokenB.approve(router.address, floatToFixed(3000));
    await tokenB.approve(fatRouter.address, floatToFixed(3000));
    await weth9.deposit({ value: floatToFixed(300) });
    await weth9.approve(router.address, floatToFixed(300));
    await weth9.approve(fatRouter.address, floatToFixed(300));

    getPool = async (
      _fee: number,
      token0: IERC20,
      token1: IERC20,
      amount0: number,
      amount1: number,
      _lookback: BigInt = BigInt(3600e18)
    ) => {
      await fatRouter.getOrCreatePoolAndAddLiquidity(
        [
          floatToFixed(_fee),
          tickSpacing,
          _lookback,
          1,
          token0.address,
          token1.address,
        ],
        0,
        [
          {
            kind: 0,
            isDelta: true,
            pos: 0,
            deltaA: floatToFixed(amount1),
            deltaB: floatToFixed(amount0),
          },
        ],
        0,
        0,
        maxDeadline
      );
      let pool: string = await factory.lookup(
        floatToFixed(_fee),
        tickSpacing,
        lookback,
        token0.address,
        token1.address
      );
      return pool;
    };
    getEthBPool = async (
      _fee: number,
      amount: number,
      _lookback: number = BigInt(3600e18)
    ) => {
      return await getPool(
        _fee,
        BigNumber.from(weth9.address).toBigInt() <
          BigNumber.from(tokenB.address).toBigInt()
          ? weth9
          : tokenB,
        BigNumber.from(weth9.address).toBigInt() <
          BigNumber.from(tokenB.address).toBigInt()
          ? tokenB
          : weth9,
        amount,
        amount,
        _lookback
      );
    };
  });

  describe("#swap exact in", () => {
    it("is able to swap, A->B", async () => {
      let _fee = 0.01 / 100;
      let pool: string = await getPool(_fee, tokenA, tokenB, 500, 500);
      const prePoolBalance = await balances(pool);
      expect(
        await router.exactInputSingle([
          tokenA.address,
          tokenB.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(10),
          0,
          0,
        ])
      )
        .to.emit(tokenA, "Transfer")
        .to.emit(tokenB, "Transfer");
      const postPoolBalance = await balances(pool);
      expect(postPoolBalance.tokenA - prePoolBalance.tokenA).to.eq(10);
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.be.lessThan(-4);
    });

    it("is able to swap, B->A", async () => {
      let _fee = 0.01 / 100;
      let pool: string = await getPool(_fee, tokenA, tokenB, 500, 500);
      const prePoolBalance = await balances(pool);
      expect(
        await router.exactInputSingle([
          tokenB.address,
          tokenA.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(10),
          0,
          0,
        ])
      )
        .to.emit(tokenA, "Transfer")
        .to.emit(tokenB, "Transfer");
      const postPoolBalance = await balances(pool);
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.eq(10);
      expect(postPoolBalance.tokenA - prePoolBalance.tokenA).to.be.lessThan(-4);
    });

    it("is able to swap eth->b with native eth", async () => {
      let pool: string = await getEthBPool(0.05, 2);
      const preEthBalance = await ethBalances();
      const prePoolBalance = await balances(pool);
      const tx = await router.exactInputSingle(
        [
          weth9.address,
          tokenB.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(1),
          0,
          0,
        ],
        { value: floatToFixed(1) }
      );
      expect(tx).to.emit(tokenB, "Transfer");
      const postPoolBalance = await balances(pool);
      const postEthBalance = await ethBalances();

      expect(postEthBalance.owner - preEthBalance.owner).to.be.approximately(
        -1,
        0.001
      );
      expect(postPoolBalance.weth9 - prePoolBalance.weth9).to.be.eq(1);
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.be.lessThan(
        0.4
      );
      expect(postEthBalance.router).to.eq(0);
    });

    it("is able to swap b->eth and receive native eth", async () => {
      let pool: string = await getEthBPool(0.05, 2);
      const preEthBalance = await ethBalances();
      const prePoolBalance = await balances(pool);
      let callData = [
        router.interface.encodeFunctionData("exactInputSingle", [
          [
            tokenB.address,
            weth9.address,
            pool,
            constants.AddressZero,
            maxDeadline,
            floatToFixed(1),
            0,
            0,
          ],
        ]),
      ];
      callData.push(
        router.interface.encodeFunctionData("unwrapWETH9", [
          floatToFixed(0.4),
          await owner.getAddress(),
        ])
      );
      await router.multicall(callData);
      const postPoolBalance = await balances(pool);
      const postEthBalance = await ethBalances();

      expect(postPoolBalance.weth9 - prePoolBalance.weth9).to.be.approximately(
        -(postEthBalance.owner - preEthBalance.owner),
        0.001
      );
      expect(postEthBalance.router).to.eq(0);
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.eq(1);
      expect(postEthBalance.owner - preEthBalance.owner).to.be.greaterThan(0.4);
    });
  });

  describe("#swap limits exact in", () => {
    it("reverts if amountMin is not outputted", async () => {
      let _fee = 0.01 / 100;
      let pool: string = await getPool(_fee, tokenA, tokenB, 50, 50);
      const beforeTokenBBalance = fixedToFloat(
        await tokenB.balanceOf(await owner.getAddress())
      );
      expect(
        await router.exactInputSingle([
          tokenA.address,
          tokenB.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(10),
          0,
          0,
        ])
      )
        .to.emit(tokenA, "Transfer")
        .to.emit(tokenB, "Transfer");
      const afterTokenBBalance = fixedToFloat(
        await tokenB.balanceOf(await owner.getAddress())
      );
      const amountReceived = afterTokenBBalance - beforeTokenBBalance;
      // swap again expecting to get the same amount out
      expect(
        router.exactInputSingle([
          tokenA.address,
          tokenB.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(10),
          floatToFixed(amountReceived),
          0,
        ])
      ).to.be.revertedWith("Too little received");
      // swap if the amount we expect is small
      expect(
        await router.exactInputSingle([
          tokenA.address,
          tokenB.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(10),
          floatToFixed(amountReceived * 0.1),
          0,
        ])
      )
        .to.emit(tokenA, "Transfer")
        .to.emit(tokenB, "Transfer");
    });

    it("partial swap if price limit is exceeded", async () => {
      const swapPool = async (_fee: number, sqrtPriceMax: number = 0) => {
        let pool: string = await getPool(_fee, tokenA, tokenB, 50, 50);
        const beforePoolPrice =
          fixedToFloat((await poolInspector.getPrice(pool)).sqrtPrice) ** 2;
        const preOwnerBalance = await balances(await owner.getAddress());
        await router.exactInputSingle([
          tokenA.address,
          tokenB.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(10),
          0,
          floatToFixed(sqrtPriceMax),
        ]);
        const postOwnerBalance = await balances(await owner.getAddress());
        const amountSent = -postOwnerBalance.tokenA + preOwnerBalance.tokenA;
        const amountReceived = postOwnerBalance.tokenB - preOwnerBalance.tokenB;
        const afterPoolPrice =
          fixedToFloat((await poolInspector.getPrice(pool)).sqrtPrice) ** 2;
        return { beforePoolPrice, afterPoolPrice, amountSent, amountReceived };
      };

      let swapData = await swapPool(0.0001);
      router.exactInputSingle;
      let middlePrice =
        (swapData.afterPoolPrice + swapData.beforePoolPrice) / 2;
      let swapData2 = await swapPool(0.0002, Math.sqrt(middlePrice));
      expect(swapData.amountSent).to.be.greaterThan(swapData2.amountSent);
      expect(swapData.amountReceived).to.be.greaterThan(
        swapData2.amountReceived
      );
      expect(swapData.afterPoolPrice).to.be.greaterThan(
        swapData2.afterPoolPrice
      );
      expect(middlePrice).to.be.approximately(
        swapData2.afterPoolPrice,
        0.000001
      );
    });
  });

  describe("#swap exact out", () => {
    it("is able to swap exactout, A->B", async () => {
      let _fee = 0.01 / 100;
      let pool: string = await getPool(_fee, tokenA, tokenB, 500, 500);
      const prePoolBalance = await balances(pool);
      expect(
        await router.exactOutputSingle([
          tokenA.address,
          tokenB.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(10),
          floatToFixed(100),
        ])
      )
        .to.emit(tokenA, "Transfer")
        .to.emit(tokenB, "Transfer");
      const postPoolBalance = await balances(pool);
      expect(postPoolBalance.tokenA - prePoolBalance.tokenA).to.be.greaterThan(
        10
      );
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.eq(-10);
    });

    it("is able to swap, B->A", async () => {
      let _fee = 0.01 / 100;
      let pool: string = await getPool(_fee, tokenA, tokenB, 500, 500);
      const prePoolBalance = await balances(pool);
      expect(
        await router.exactOutputSingle([
          tokenB.address,
          tokenA.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(10),
          floatToFixed(1000),
        ])
      )
        .to.emit(tokenA, "Transfer")
        .to.emit(tokenB, "Transfer");
      const postPoolBalance = await balances(pool);
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.be.greaterThan(
        8
      );
      expect(postPoolBalance.tokenA - prePoolBalance.tokenA).to.eq(-10);
    });

    it("is able to swap eth->b with native eth", async () => {
      let pool: string = await getEthBPool(0.05, 2);
      const preEthBalance = await ethBalances();
      const prePoolBalance = await balances(pool);
      let callData = [
        router.interface.encodeFunctionData("exactOutputSingle", [
          [
            weth9.address,
            tokenB.address,
            pool,
            constants.AddressZero,
            maxDeadline,
            floatToFixed(1),
            floatToFixed(1000),
          ],
        ]),
      ];
      callData.push(router.interface.encodeFunctionData("refundETH", []));
      await router.multicall(callData, { value: floatToFixed(2) });
      const postPoolBalance = await balances(pool);
      const postEthBalance = await ethBalances();

      expect(postEthBalance.owner - preEthBalance.owner).to.be.lessThan(-0.8);
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.be.eq(-1);

      expect(postEthBalance.router).to.eq(0);
    });

    it("is able to swap b->eth and receive native eth", async () => {
      let pool: string = await getEthBPool(0.05, 2);
      const preEthBalance = await ethBalances();
      const prePoolBalance = await balances(pool);
      let callData = [
        router.interface.encodeFunctionData("exactOutputSingle", [
          [
            tokenB.address,
            weth9.address,
            pool,
            constants.AddressZero,
            maxDeadline,
            floatToFixed(1),
            floatToFixed(1000),
          ],
        ]),
      ];
      callData.push(
        router.interface.encodeFunctionData("unwrapWETH9", [
          floatToFixed(1),
          await owner.getAddress(),
        ])
      );
      await router.multicall(callData);
      const postPoolBalance = await balances(pool);
      const postEthBalance = await ethBalances();
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.be.greaterThan(
        0.8
      );
      expect(postEthBalance.router).to.eq(0);
      expect(postEthBalance.owner - preEthBalance.owner).to.be.approximately(
        1,
        0.001
      );
    });
  });

  describe("#swap limits exact out", () => {
    it("reverts if more than amountMax is required for single hop", async () => {
      let _fee = 0.01 / 100;
      let pool: string = await getPool(_fee, tokenA, tokenB, 50, 50);
      expect(
        router.exactOutputSingle([
          tokenA.address,
          tokenB.address,
          pool,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(10),
          floatToFixed(1),
        ])
      ).to.be.revertedWith("Too much requested");
    });
  });
});
