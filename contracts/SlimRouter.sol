// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@maverick/contracts/contracts/interfaces/IPool.sol";
import "@maverick/contracts/contracts/interfaces/IFactory.sol";
import "@maverick/contracts/contracts/interfaces/IPosition.sol";
import "./interfaces/ISlimRouter.sol";
import "./interfaces/external/IWETH9.sol";
import "./libraries/TransferHelper.sol";
import "./libraries/Deadline.sol";
import "./libraries/Multicall.sol";
import "./libraries/SelfPermit.sol";
contract SlimRouter is ISlimRouter, Multicall, SelfPermit, Deadline {
    /// @inheritdoc ISlimRouter
    IFactory public immutable factory;
    /// @inheritdoc ISlimRouter
    IPosition public immutable position;
    /// @inheritdoc ISlimRouter
    IWETH9 public immutable WETH9;
    constructor(IFactory _factory, IWETH9 _WETH9) {
        factory = _factory;
        position = _factory.position();
        WETH9 = _WETH9;
    }
    receive() external payable {
        require(IWETH9(msg.sender) == WETH9, "Not WETH9");
    }
    /// @inheritdoc ISlimRouter
    function unwrapWETH9(uint256 amountMinimum, address recipient) public payable override {
        uint256 balanceWETH9 = WETH9.balanceOf(address(this));
        require(balanceWETH9 >= amountMinimum, "Insufficient WETH9");
        if (balanceWETH9 > 0) {
            WETH9.withdraw(balanceWETH9);
            TransferHelper.safeTransferETH(recipient, balanceWETH9);
        }
    }
    /// @inheritdoc ISlimRouter
    function sweepToken(IERC20 token, uint256 amountMinimum, address recipient) public payable {
        uint256 balanceToken = token.balanceOf(address(this));
        require(balanceToken >= amountMinimum, "Insufficient token");
        if (balanceToken > 0) {
            TransferHelper.safeTransfer(address(token), recipient, balanceToken);
        }
    }
    /// @inheritdoc ISlimRouter
    function refundETH() external payable override {
        if (address(this).balance > 0) TransferHelper.safeTransferETH(msg.sender, address(this).balance);
    }
    /// @param token The token to pay
    /// @param payer The entity that must pay
    /// @param recipient The entity that will receive payment
    /// @param value The amount to pay
    function pay(IERC20 token, address payer, address recipient, uint256 value) internal {
        if (IWETH9(address(token)) == WETH9 && address(this).balance >= value) {
            WETH9.deposit{value: value}();
            WETH9.transfer(recipient, value);
        } else if (payer == address(this)) {
            TransferHelper.safeTransfer(address(token), recipient, value);
        } else {
            TransferHelper.safeTransferFrom(address(token), payer, recipient, value);
        }
    }
    // Ensure that you only approve the correct input amount and revoke the rights after the transaction is done
    function swapCallback(uint256 amountToPay, uint256 amountOut, bytes calldata _data) external {
        (address token, address payer) = abi.decode(_data, (address, address));
        pay(IERC20(token), payer, msg.sender, amountToPay);
    }
    /// @inheritdoc ISlimRouter
    function exactInputSingle(ExactInputSingleParams calldata params) external payable override checkDeadline(params.deadline) returns (uint256 amountOut) {
        bool tokenAIn = params.tokenIn < params.tokenOut;
        (, amountOut) = params.pool.swap(
            (params.recipient == address(0)) ? address(this) : params.recipient,
            params.amountIn,
            tokenAIn,
            false,
            params.sqrtPriceLimitD18,
            abi.encode(params.tokenIn, msg.sender)
        );
        require(amountOut >= params.amountOutMinimum, "Too little received");
    }
    /// @inheritdoc ISlimRouter
    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable override checkDeadline(params.deadline) returns (uint256 amountIn) {
        bool tokenAIn = params.tokenIn < params.tokenOut;
        uint256 amountOutReceived;
        (amountIn, amountOutReceived) = params.pool.swap(
            (params.recipient == address(0)) ? address(this) : params.recipient,
            params.amountOut,
            tokenAIn,
            true,
            0,
            abi.encode(params.tokenIn, msg.sender)
        );
        require(amountOutReceived == params.amountOut, "Requested amount not available");
        require(amountIn <= params.amountInMaximum, "Too much requested");
    }
}
