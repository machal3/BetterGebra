/**
 * The Wykresy panel's React parts, rendered into the page's static containers: the list and the parameters into
 * the side panel, the tools and the Badanie card over the canvas (which stays outside React).
 */
import { createPortal } from 'react-dom';
import { Analysis } from './Analysis';
import { FunctionList } from './FunctionList';
import { Parameters } from './Parameters';
import { StageTools } from './StageTools';
import './graphs.css';

export function GraphsPanel() {
  const side = document.getElementById('graphs-body'), stage = document.getElementById('stage');
  return (
    <>
      {side && createPortal(<><FunctionList /><Parameters /></>, side)}
      {stage && createPortal(<><StageTools /><Analysis /></>, stage)}
    </>
  );
}
