import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {CurtainRevisionScenario} from "./CurtainRevisionScenario"
import {CurtainReachScenario} from "./CurtainReachScenario"
import {CurtainCancelScenario} from "./CurtainCancelScenario"
import {PublicRecordingScenario} from "./PublicRecordingScenario"
import {AuthorWatchScenario} from "./AuthorWatchScenario"
import {PackingThirdCaseScenario} from "./PackingThirdCaseScenario";
import {RoomPairScenario} from "./RoomPairScenario";
import {ClosedPairScenario} from "./ClosedPairScenario"
import {PackingPartialScenario} from "./PackingPartialScenario"
import {OriginalViewScenario} from "./OriginalViewScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id:"countercase-room-pair-switch",typename:RoomPairScenario.getTypeName(),parameters:{__leaf__timeout_secs:"120"}},
    {id:"countercase-packing-third-case",typename:PackingThirdCaseScenario.getTypeName(),parameters:{__leaf__timeout_secs:"240"}},
    {id: "countercase-public-recording", typename: PublicRecordingScenario.getTypeName(), parameters: {__leaf__timeout_secs: "60"}},
    {id: "countercase-curtain-revision", typename: CurtainRevisionScenario.getTypeName(), parameters: {__leaf__timeout_secs: "120"}},
    {id: "countercase-curtain-reach", typename: CurtainReachScenario.getTypeName(), parameters: {__leaf__timeout_secs: "60"}},
    {id: "countercase-curtain-cancel", typename: CurtainCancelScenario.getTypeName(), parameters: {__leaf__timeout_secs: "60"}},
    {id: "countercase-author-watch", typename: AuthorWatchScenario.getTypeName(), parameters: {__leaf__timeout_secs: "120"}},
    {id: "countercase-closed-pair", typename: ClosedPairScenario.getTypeName(), parameters: {__leaf__timeout_secs: "120"}},
    {id: "countercase-packing-partial", typename: PackingPartialScenario.getTypeName(), parameters: {__leaf__timeout_secs: "120"}},
    {id: "countercase-original-view", typename: OriginalViewScenario.getTypeName(), parameters: {__leaf__timeout_secs: "120"}},
  ]
}
