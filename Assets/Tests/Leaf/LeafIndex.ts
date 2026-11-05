import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {CurtainRevisionScenario} from "./CurtainRevisionScenario"
import {CurtainReachScenario} from "./CurtainReachScenario"
import {CurtainCancelScenario} from "./CurtainCancelScenario"
import {PublicRecordingScenario} from "./PublicRecordingScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id: "countercase-public-recording", typename: PublicRecordingScenario.getTypeName(), parameters: {__leaf__timeout_secs: "60"}},
    {id: "countercase-curtain-revision", typename: CurtainRevisionScenario.getTypeName(), parameters: {__leaf__timeout_secs: "120"}},
    {id: "countercase-curtain-reach", typename: CurtainReachScenario.getTypeName(), parameters: {__leaf__timeout_secs: "60"}},
    {id: "countercase-curtain-cancel", typename: CurtainCancelScenario.getTypeName(), parameters: {__leaf__timeout_secs: "60"}},
  ]
}
