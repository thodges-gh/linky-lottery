pragma solidity ^0.6.0;

import "@chainlink/contracts/src/v0.6/interfaces/LinkTokenInterface.sol";
import "@chainlink/contracts/src/v0.6/VRFConsumerBase.sol";

contract MockVRFCoordinator {
  LinkTokenInterface internal LINK;
  uint256 internal fee;

  constructor(
    LinkTokenInterface _link,
    uint256 _fee
  ) public {
    LINK = _link;
    fee = _fee;
  }

  function onTokenTransfer(address _sender, uint256 _fee, bytes memory _data)
    public
    onlyLINK()
  {
    (bytes32 keyHash, uint256 seed) = abi.decode(_data, (bytes32, uint256));
    randomnessRequest(keyHash, seed, _fee, _sender);
  }

  function randomnessRequest(
    bytes32 _keyHash,
    uint256 _consumerSeed,
    uint256 _feePaid,
    address _sender
  )
    internal
    sufficientLINK(_feePaid, _keyHash)
  {
    assert(_feePaid < 1e27); // Total LINK fits in uint96
    assert(_feePaid >= fee);
  }

  function fulfillRandomnessRequest(
    address _callbackContract,
    bytes32 _requestId,
    uint256 _randomness
  ) public {
    VRFConsumerBase v;
    bytes memory resp = abi.encodeWithSelector(
      v.rawFulfillRandomness.selector, _requestId, _randomness);
    (bool success,) = _callbackContract.call(resp);
    (success);
  }

  modifier onlyLINK() {
    require(msg.sender == address(LINK), "Must use LINK token");
    _;
  }

  modifier sufficientLINK(uint256 _feePaid, bytes32) {
    require(_feePaid >= fee, "Below agreed payment");
    _;
  }
}
