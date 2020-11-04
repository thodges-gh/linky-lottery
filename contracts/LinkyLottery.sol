// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./vendor/VRFConsumerBase.sol";
import "@chainlink/contracts/src/v0.6/interfaces/AggregatorInterface.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract LinkyLottery is ERC721, VRFConsumerBase {
  using SafeMath for uint256;
  AggregatorInterface public immutable gasPriceFeed;
  AggregatorInterface public immutable linkUsdFeed;
  LinkTokenInterface public immutable linkToken;
  bytes32 public immutable vrfKeyHash;
  uint256 public immutable vrfFee;
  uint256 public constant TICKET_COST = 500000000; // $5.00
  uint256 public constant LAST_SEVEN = 10000000;
  uint256 public constant RANDOMNESS_FREQUENCY = 14 days;
  uint256 public constant PURCHASE_FREQUENCY = 7 days;

  uint256 public counter;
  uint256 public winningNumber;
  bytes32 public activeRequest;
  uint256 public lastCalled;
  uint256 public currentPot;
  uint256 public unclaimedPot;
  uint256 public treasury;

  struct Ticket {
    bytes32 numHash;
    uint256 purchaseTime;
  }

  mapping(uint256 => Ticket) public tickets;

  constructor(
    AggregatorInterface _gasPriceFeed,
    AggregatorInterface _linkUsdFeed,
    LinkTokenInterface _linkToken,
    address _vrfCoordinator,
    bytes32 _vrfKeyHash,
    uint256 _vrfFee
  )
    public
    ERC721("LinkyLottery Ticket", "LLT")
    VRFConsumerBase(_vrfCoordinator, address(_linkToken))
  {
    gasPriceFeed = _gasPriceFeed;
    linkUsdFeed = _linkUsdFeed;
    linkToken = _linkToken;
    vrfKeyHash = _vrfKeyHash;
    vrfFee = _vrfFee;
    counter = 1;
    lastCalled = block.timestamp;
  }

  function onTokenTransfer(
    address _sender,
    uint256 _amount,
    bytes calldata _data
  )
    external
  {
    require(msg.sender == address(linkToken), "Must use LINK token");
    require(acceptingPurchases(), "Lottery not accepting purchases");
    uint256 answer = uint256(linkUsdFeed.latestAnswer());
    uint256 currentPrice = answer.mul(1e10);
    require(_amount >= TICKET_COST.mul(1e18).div(currentPrice).mul(1e10), "Insufficient LINK to purchase");
    (bytes32 numHash) = abi.decode(_data, (bytes32));
    require(numHash != keccak256(abi.encodePacked(uint256(0))), "Invalid number");
    tickets[counter] = Ticket(numHash, block.timestamp);
    _safeMint(_sender, counter);
    counter++;
    if (treasury < vrfFee) {
      uint256 diff = vrfFee.sub(treasury);
      if (diff < _amount) {
        treasury = treasury.add(diff);
        _amount = _amount.sub(diff);
      } else {
        treasury = treasury.add(_amount);
        _amount = 0;
      }
    }
    currentPot = currentPot.add(_amount);
  }

  function initiateRandomnessRequest() external {
    require(canInitiateRandomnessRequest(), "Requested randomness too soon");
    require(tx.gasprice <= uint256(gasPriceFeed.latestAnswer()), "Gas price too high");
    lastCalled = block.timestamp;
    uint256 seed = uint256(keccak256(abi.encodePacked(linkUsdFeed.latestAnswer())));
    activeRequest = requestRandomness(vrfKeyHash, vrfFee, seed);
    delete treasury;
    delete winningNumber;
  }

  function fulfillRandomness(bytes32, uint256 _winningNumber) internal override {
    winningNumber = _winningNumber % LAST_SEVEN;
    unclaimedPot = currentPot.add(unclaimedPot);
    delete currentPot;
    delete activeRequest;
  }

  function claimLottery(uint256 _tokenId, uint256 _winningNumber) external {
    require(msg.sender == ownerOf(_tokenId), "Not owner of ticket");
    require(activeRequest == bytes32(0), "Active request already in flight");
    require(keccak256(abi.encodePacked(_winningNumber)) == tickets[_tokenId].numHash, "Wrong number from hash");
    require(block.timestamp.sub(RANDOMNESS_FREQUENCY) < tickets[_tokenId].purchaseTime, "Ticket expired");
    require(_winningNumber % LAST_SEVEN == winningNumber, "Not winning number");
    delete tickets[_tokenId];
    delete winningNumber;
    _burn(_tokenId);
    linkToken.transfer(msg.sender, unclaimedPot);
    delete unclaimedPot;
  }

  function acceptingPurchases() public view returns (bool) {
    return block.timestamp.sub(PURCHASE_FREQUENCY) > lastCalled;
  }

  function canInitiateRandomnessRequest() public view returns (bool) {
    return block.timestamp.sub(RANDOMNESS_FREQUENCY) > lastCalled;
  }
}
