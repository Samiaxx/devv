// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProofOfDev
 * @notice Soulbound (non-transferable) ERC-721 NFT representing a developer's
 *         on-chain reputation score. Each wallet can only mint once.
 *
 * Soulbound mechanism: transfers are blocked except for minting (from == address(0))
 * and burning (to == address(0)).
 */
contract ProofOfDev {
    // ─── Events ────────────────────────────────────────────────────────────────

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Minted(address indexed to, uint256 indexed tokenId, uint256 score);

    // ─── Storage ───────────────────────────────────────────────────────────────

    string public name = "Proof of Dev";
    string public symbol = "POD";

    uint256 private _nextTokenId = 1;

    // tokenId → owner
    mapping(uint256 => address) private _owners;

    // owner → tokenId (0 = no token)
    mapping(address => uint256) private _tokens;

    // tokenId → metadata
    struct DevMetadata {
        uint256 score;
        uint256 contractCount;
        uint256 verifiedContractCount;
        bool hasENS;
        uint256 mintedAt;
    }

    mapping(uint256 => DevMetadata) private _metadata;

    // Base URI for token metadata (points to our API)
    string private _baseTokenURI;

    address public owner;

    // ─── Constructor ───────────────────────────────────────────────────────────

    constructor(string memory baseTokenURI) {
        _baseTokenURI = baseTokenURI;
        owner = msg.sender;
    }

    // ─── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ─── ERC-721 Core ──────────────────────────────────────────────────────────

    function balanceOf(address account) public view returns (uint256) {
        require(account != address(0), "Zero address");
        return _tokens[account] != 0 ? 1 : 0;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "Token does not exist");
        return tokenOwner;
    }

    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_owners[tokenId] != address(0), "Token does not exist");
        return string(abi.encodePacked(_baseTokenURI, "/", _toString(tokenId)));
    }

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f || // ERC-721Metadata
            interfaceId == 0x01ffc9a7;   // ERC-165
    }

    // ─── Soulbound: block all transfers ────────────────────────────────────────

    function transferFrom(address, address, uint256) public pure {
        revert("Soulbound: non-transferable");
    }

    function safeTransferFrom(address, address, uint256) public pure {
        revert("Soulbound: non-transferable");
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) public pure {
        revert("Soulbound: non-transferable");
    }

    function approve(address, uint256) public pure {
        revert("Soulbound: non-transferable");
    }

    function setApprovalForAll(address, bool) public pure {
        revert("Soulbound: non-transferable");
    }

    // ─── Minting ───────────────────────────────────────────────────────────────

    /**
     * @notice Mint a Proof-of-Dev token for the caller.
     * @dev Each address can only mint once. The score and metadata are stored on-chain.
     */
    function mint(
        uint256 score,
        uint256 contractCount,
        uint256 verifiedContractCount,
        bool hasENS
    ) external returns (uint256) {
        require(_tokens[msg.sender] == 0, "Already minted");

        uint256 tokenId = _nextTokenId++;

        _owners[tokenId] = msg.sender;
        _tokens[msg.sender] = tokenId;

        _metadata[tokenId] = DevMetadata({
            score: score,
            contractCount: contractCount,
            verifiedContractCount: verifiedContractCount,
            hasENS: hasENS,
            mintedAt: block.timestamp
        });

        emit Transfer(address(0), msg.sender, tokenId);
        emit Minted(msg.sender, tokenId, score);

        return tokenId;
    }

    // ─── Metadata Getters ──────────────────────────────────────────────────────

    function getMetadata(uint256 tokenId)
        external
        view
        returns (DevMetadata memory)
    {
        require(_owners[tokenId] != address(0), "Token does not exist");
        return _metadata[tokenId];
    }

    function getTokenByAddress(address account) external view returns (uint256) {
        return _tokens[account];
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // ─── Admin ─────────────────────────────────────────────────────────────────

    function setBaseURI(string memory baseTokenURI) external onlyOwner {
        _baseTokenURI = baseTokenURI;
    }

    // ─── Utilities ─────────────────────────────────────────────────────────────

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
