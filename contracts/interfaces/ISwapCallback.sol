// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@maverick/contracts/contracts/interfaces/IPool.sol";
interface ISwapCallback {
    function swapCallback(
        uint256 amountIn,
        uint256 amountOut,
        bytes calldata data
    ) external;
    struct AddLiquidityCallbackData {
        IERC20 tokenA;
        IERC20 tokenB;
        IPool pool;
        address payer;
    }
    struct SwapCallbackData {
        bytes path;
        address payer;
        bool exactOutput;
    }
}
