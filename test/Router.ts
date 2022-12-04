import { ethers } from "hardhat";
import { expect, use } from "chai";
import { constants, Signer, BigNumber } from "ethers";
import chaiAsPromised from "chai-as-promised";

import {
  Factory,
  Position,
  Router,
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
  deployRouter,
  deployPoolInspector,
  deployWETH9,
} from "./shared/deploy";

import { fixedToFloat, floatToFixed, encodePath } from "./shared/utils";

use(chaiAsPromised);

describe("Router", () => {
  let owner: Signer;
  let addr1: Signer;
  let tokenA: TestERC20;
  let tokenB: TestERC20;
  let position: Position;
  let factory: Factory;
  let poolInspector: PoolInspector;
  let router: Router;
  let weth9: IWETH9;
  let maxDeadline: number = 1e13;
  let tickSpacing: bigint = BigInt(
    Math.floor(Math.log(1.1) / Math.log(1.0001))
  );
  let lookback: number = 3600;
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
      position: position.address,
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
    await tokenB.mint(await owner.getAddress(), floatToFixed(3000));
    await tokenB.approve(router.address, floatToFixed(3000));
    await weth9.deposit({ value: floatToFixed(300) });
    await weth9.approve(router.address, floatToFixed(300));

    getPool = async (
      _fee: number,
      token0: IERC20,
      token1: IERC20,
      amount0: number,
      amount1: number,
      _lookback: number = 3600
    ) => {
      await router.getOrCreatePoolAndAddLiquidity(
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
      _lookback: number = 3600
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

  describe("#getOrCreatePoolAndAddLiquidity", () => {
    it("is able to create pool and add liquidity", async () => {
      await expect(
        router.getOrCreatePoolAndAddLiquidity(
          [
            floatToFixed(0.5 / 100),
            BigInt(Math.floor(Math.log(1.1) / Math.log(1.0001))),
            3600,
            1,
            tokenA.address,
            tokenB.address,
          ],
          0,
          [
            {
              kind: 0,
              isDelta: true,
              pos: 0,
              deltaA: floatToFixed(500),
              deltaB: floatToFixed(500),
            },
          ],
          0,
          0,
          maxDeadline
        )
      ).to.emit(factory, "PoolCreated");
    });

    it("is able to add and remove liquidity to existing pool", async () => {
      let pool: string = await getPool(0.5, tokenA, tokenB, 500, 500);
      const prePoolBalance = await balances(pool);
      const tx = await router.addLiquidityToPool(
        pool,
        tokenId,
        [
          {
            kind: 0,
            isDelta: true,
            pos: 0,
            deltaA: floatToFixed(500),
            deltaB: floatToFixed(500),
          },
        ],
        0,
        0,
        maxDeadline
      );
      const receipt = await tx.wait();
      const postPoolBalance = await balances(pool);

      expect(postPoolBalance.tokenA - prePoolBalance.tokenA).to.eq(500);
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.eq(500);

      await position.approve(router.address, tokenId);

      await router.removeLiquidity(
        pool,
        await owner.getAddress(),
        tokenId,
        [
          {
            binId: 1,
            amount: floatToFixed(500),
            maxDepth: 0,
          },
        ],
        0,
        0,
        maxDeadline
      );
      const postRMPoolBalance = await balances(pool);
      expect(postPoolBalance.tokenA - postRMPoolBalance.tokenA).to.eq(500);
      expect(postPoolBalance.tokenB - postRMPoolBalance.tokenB).to.eq(500);
      await position.approve(constants.AddressZero, tokenId);

      // revert since we haven't approved the router
      expect(
        router.removeLiquidity(
          pool,
          await owner.getAddress(),
          tokenId,
          [
            {
              binId: 1,
              amount: floatToFixed(1000),
              maxDepth: 0,
            },
          ],
          0,
          0,
          maxDeadline
        )
      ).to.be.revertedWith("P");

      await position.approve(constants.AddressZero, tokenId);
      await position.approve(router.address, tokenId);
      expect(
        router.removeLiquidity(
          pool,
          await owner.getAddress(),
          tokenId,
          [
            {
              binId: 1,
              amount: floatToFixed(1000),
              maxDepth: 0,
            },
          ],
          floatToFixed(1000),
          0,
          maxDeadline
        )
      ).to.be.revertedWith("Too little removed");
    });

    it("respects activeTick limits", async () => {
      let pool: string = await getPool(0.5, tokenA, tokenB, 50, 50);
      expect(
        router.addLiquidityWTickLimits(
          pool,
          tokenId,
          [
            {
              kind: 0,
              isDelta: true,
              pos: 0,
              deltaA: floatToFixed(50),
              deltaB: floatToFixed(50),
            },
            {
              kind: 0,
              isDelta: true,
              pos: 10,
              deltaA: floatToFixed(50),
              deltaB: floatToFixed(50),
            },
          ],
          0,
          0,
          5,
          11,
          maxDeadline
        )
      ).to.be.revertedWith("activeTick not in range");
    });

    it("is able to add liquidity weth-token pool", async () => {
      let pool: string = await getEthBPool(0.05, 5);
      const prePoolBalance = await balances(pool);
      await router.addLiquidityToPool(
        pool,
        tokenId,
        [
          {
            kind: 0,
            isDelta: true,
            pos: 0,
            deltaA: floatToFixed(5),
            deltaB: floatToFixed(5),
          },
        ],
        0,
        0,
        maxDeadline
      );
      const postPoolBalance = await balances(pool);
      expect(postPoolBalance.weth9 - prePoolBalance.weth9).to.eq(5);
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.eq(5);
    });

    it("reverts if deadline has passed", async () => {
      let pool: string = await getEthBPool(0.05, 5);
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);
      expect(
        router.addLiquidityToPool(
          pool,
          tokenId,
          [
            {
              kind: 0,
              isDelta: true,
              pos: 0,
              deltaA: floatToFixed(5),
              deltaB: floatToFixed(5),
            },
          ],
          0,
          0,
          1
        )
      ).to.be.revertedWith("Transaction too old");
    });

    it("is able to remove native ETH from weth-token pool", async () => {
      let pool: string = await getEthBPool(0.05, 5);
      const preEthBalance = await ethBalances();
      const prePoolBalance = await balances(pool);
      const preOwnerBalance = await balances(await owner.getAddress());
      await position.approve(router.address, tokenId);

      let callData = [
        router.interface.encodeFunctionData("removeLiquidity", [
          pool,
          constants.AddressZero,
          tokenId,
          [
            {
              binId: 1,
              amount: floatToFixed(1000),
              maxDepth: 0,
            },
          ],
          0,
          0,
          maxDeadline,
        ]),
      ];
      callData.push(
        router.interface.encodeFunctionData("unwrapWETH9", [
          floatToFixed(0),
          await owner.getAddress(),
        ])
      );
      callData.push(
        router.interface.encodeFunctionData("sweepToken", [
          tokenB.address,
          floatToFixed(0),
          await owner.getAddress(),
        ])
      );

      await router.multicall(callData);
      const postPoolBalance = await balances(pool);
      const postEthBalance = await ethBalances();
      const postOwnerBalance = await balances(await owner.getAddress());

      expect(postEthBalance.owner - preEthBalance.owner).to.be.approximately(
        5,
        0.001
      );
      expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.be.eq(-5);
      expect(postOwnerBalance.weth9 - preOwnerBalance.weth9).to.be.eq(0);
      expect(postPoolBalance.weth9 - prePoolBalance.weth9).to.be.eq(-5);
    });
  });

  it("is able to add native eth liquidity to weth-token pool", async () => {
    let pool: string = await getEthBPool(0.05, 5);
    const preEthBalance = await ethBalances();
    const prePoolBalance = await balances(pool);
    await router.addLiquidityToPool(
      pool,
      tokenId,
      [
        {
          kind: 0,
          isDelta: true,
          pos: 0,
          deltaA: floatToFixed(5),
          deltaB: floatToFixed(5),
        },
      ],
      0,
      0,
      maxDeadline,
      { value: floatToFixed(5) }
    );
    const postPoolBalance = await balances(pool);
    const postEthBalance = await ethBalances();
    expect(postEthBalance.owner - preEthBalance.owner).to.be.approximately(
      -5,
      0.001
    );
    expect(postPoolBalance.tokenB - prePoolBalance.tokenB).to.be.eq(5);
    expect(postPoolBalance.weth9 - prePoolBalance.weth9).to.be.eq(5);
  });

  it("reverts if amount min on add liquidity not reached", async () => {
    let pool: string = await getEthBPool(0.05, 5);
    expect(
      router.addLiquidityToPool(
        pool,
        tokenId,
        [
          {
            kind: 0,
            isDelta: true,
            pos: 0,
            deltaA: floatToFixed(5),
            deltaB: floatToFixed(5),
          },
        ],
        floatToFixed(6),
        0,
        maxDeadline,
        { value: floatToFixed(5) }
      )
    ).to.be.revertedWith("Too little added");
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

    it("is able to swap, weth->B->A", async () => {
      let poolWETHB: string = await getEthBPool(0.05, 2);
      let poolAB: string = await getPool(0.01, tokenA, tokenB, 500, 500);
      const preABPoolBalance = await balances(poolAB);
      const preETHPoolBalance = await balances(poolWETHB);
      const preOwnerBalance = await balances(await owner.getAddress());
      let path = encodePath([
        weth9.address,
        poolWETHB,
        tokenB.address,
        poolAB,
        tokenA.address,
      ]);
      expect(
        await router.exactInput([
          path,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(1),
          0,
          0,
        ])
      )
        .to.emit(tokenA, "Transfer")
        .to.emit(tokenB, "Transfer")
        .to.emit(weth9, "Transfer");
      const postABPoolBalance = await balances(poolAB);
      const postETHPoolBalance = await balances(poolWETHB);
      const postOwnerBalance = await balances(await owner.getAddress());
      expect(postETHPoolBalance.weth9 - preETHPoolBalance.weth9).to.be.eq(1);
      expect(
        postETHPoolBalance.tokenB - preETHPoolBalance.tokenB
      ).to.be.lessThan(-0.5);
      expect(
        postABPoolBalance.tokenB - preABPoolBalance.tokenB
      ).to.be.greaterThan(0.5);
      expect(postABPoolBalance.tokenA - preABPoolBalance.tokenA).to.be.lessThan(
        -0.5
      );

      expect(
        postOwnerBalance.tokenA - preOwnerBalance.tokenA
      ).to.be.greaterThan(0.5);
      expect(postOwnerBalance.tokenB - preOwnerBalance.tokenB).to.be.eq(0);
      expect(postOwnerBalance.weth9 - preOwnerBalance.weth9).to.be.lessThan(
        -0.5
      );
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

    it("is able to multi-hop swap, A->B->WETH with one call", async () => {
      let poolWETHB: string = await getEthBPool(0.05, 2);
      let poolAB: string = await getPool(0.01, tokenA, tokenB, 500, 500);
      const preABPoolBalance = await balances(poolAB);
      const preETHPoolBalance = await balances(poolWETHB);
      const preOwnerBalance = await balances(await owner.getAddress());

      // path is in reverse order for exactOutput
      let path = [
        weth9.address,
        poolWETHB,
        tokenB.address,
        poolAB,
        tokenA.address,
      ];

      let hopIn = await router.callStatic.exactOutputSingle([
        path[2],
        path[0],
        path[1],
        await owner.getAddress(),
        maxDeadline,
        floatToFixed(1),
        floatToFixed(1000),
      ]);
      let twoHopIn = await router.callStatic.exactOutputSingle([
        path[4],
        path[2],
        path[3],
        await owner.getAddress(),
        maxDeadline,
        hopIn,
        floatToFixed(1000),
      ]);

      let pathEncoded = encodePath(path);
      let requiredIn = await router.callStatic.exactOutput([
        pathEncoded,
        await owner.getAddress(),
        maxDeadline,
        floatToFixed(1),
        floatToFixed(1000),
      ]);
      expect(twoHopIn).to.eq(requiredIn);

      expect(
        await router.exactOutput([
          pathEncoded,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(1),
          floatToFixed(1000),
        ])
      )
        .to.emit(tokenA, "Transfer")
        .to.emit(tokenB, "Transfer")
        .to.emit(weth9, "Transfer");
      const postABPoolBalance = await balances(poolAB);
      const postETHPoolBalance = await balances(poolWETHB);
      const postOwnerBalance = await balances(await owner.getAddress());

      expect(
        postABPoolBalance.tokenA - preABPoolBalance.tokenA
      ).to.be.greaterThan(1);
      expect(postABPoolBalance.tokenB - preABPoolBalance.tokenB).to.lessThan(
        -0.9
      );
      expect(postABPoolBalance.weth9 - preABPoolBalance.weth9).to.eq(0);

      expect(postETHPoolBalance.tokenA - preETHPoolBalance.tokenA).to.eq(0);
      expect(
        postETHPoolBalance.tokenB - preETHPoolBalance.tokenB
      ).to.greaterThan(0.9);
      expect(postETHPoolBalance.weth9 - preETHPoolBalance.weth9).to.eq(-1);

      expect(
        postOwnerBalance.tokenA - preOwnerBalance.tokenA
      ).to.be.approximately(-fixedToFloat(requiredIn), 0.000000001);
      expect(postOwnerBalance.tokenB - preOwnerBalance.tokenB).to.eq(0);
      expect(postOwnerBalance.weth9 - preOwnerBalance.weth9).to.eq(1);
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

    it("reverts if more than amountMax is required for multi hop", async () => {
      let poolWETHB: string = await getEthBPool(0.05, 2);
      let poolAB: string = await getPool(0.01, tokenA, tokenB, 500, 500);

      // path is in reverse order for exactOutput
      let path = [
        weth9.address,
        poolWETHB,
        tokenB.address,
        poolAB,
        tokenA.address,
      ];
      let pathEncoded = encodePath(path);

      expect(
        router.exactOutput([
          pathEncoded,
          await owner.getAddress(),
          maxDeadline,
          floatToFixed(1),
          floatToFixed(1),
        ])
      ).to.be.revertedWith("Too much requested");
    });
  });

  describe("#migrate bins", () => {
    it("returns pool event for migration when called", async () => {
      let _fee = 0.01 / 100;
      let pool: string = await getPool(_fee, tokenA, tokenB, 50, 50);
      let poolContract = await Pool__factory.connect(pool, owner);

      await expect(
        router.migrateBinsUpStack(pool, [0, 1, 3], 0, maxDeadline)
      ).to.emit(poolContract, "MigrateBinsUpStack");
    });
  });
});
