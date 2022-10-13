// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@maverick/contracts/contracts/interfaces/IPool.sol";
import "./BytesLib.sol";
/// @title Functions for manipulating path data for multihop swaps
library Path {
    using BytesLib for bytes;
    /// @dev The length of the bytes encoded address
    uint256 private constant ADDR_SIZE = 20;
    /// @dev The offset of a single token address and pool address
    uint256 private constant NEXT_OFFSET = ADDR_SIZE + ADDR_SIZE;
    /// @dev The offset of an encoded pool key
    uint256 private constant POP_OFFSET = NEXT_OFFSET + ADDR_SIZE;
    /// @dev The minimum length of an encoding that contains 2 or more pools
    uint256 private constant MULTIPLE_POOLS_MIN_LENGTH = POP_OFFSET + NEXT_OFFSET;
    /// @notice Returns true iff the path contains two or more pools
    /// @param path The encoded swap path
    /// @return True if path contains two or more pools, otherwise false
    function hasMultiplePools(bytes memory path) internal pure returns (bool) {
        return path.length >= MULTIPLE_POOLS_MIN_LENGTH;
    }
    /// @notice Returns the number of pools in the path
    /// @param path The encoded swap path
    /// @return The number of pools in the path
    function numPools(bytes memory path) internal pure returns (uint256) {
        // Ignore the first token address. From then on every fee and token offset indicates a pool.
        return ((path.length - ADDR_SIZE) / NEXT_OFFSET);
    }
    /// @notice Decodes the first pool in path
    /// @param path The bytes encoded swap path
    /// @return tokenIn The input in a path
    /// @return tokenOut The output in a path
    /// @return pool The pool
    function decodeFirstPool(bytes memory path)
        internal
        pure
        returns (
            IERC20 tokenIn,
            IERC20 tokenOut,
            IPool pool
        )
    {
        tokenIn = IERC20(path.toAddress(0));
        pool = IPool(path.toAddress(ADDR_SIZE));
        tokenOut = IERC20(path.toAddress(NEXT_OFFSET));
    }
    /// @notice Gets the segment corresponding to the first pool in the path
    /// @param path The bytes encoded swap path
    /// @return The segment containing all data necessary to target the first pool in the path
    function getFirstPool(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(0, POP_OFFSET);
    }
    /// @notice Skips a token + pool element from the buffer and returns the remainder
    /// @param path The swap path
    /// @return The remaining token + pool elements in the path
    function skipToken(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(NEXT_OFFSET, path.length - NEXT_OFFSET);
    }
}
