import { AgentRun } from "@/types/run";

import RunTimeline from "./RunTimeline";


interface Props {

  run:AgentRun;

}


export default function RunCard({
  run
}:Props){


return (

<div
className="
border
rounded
p-4
"
>


<h2>
{run.id}
</h2>


<p>
Status:
{run.status}
</p>


<p>
Duration:
{run.duration}
</p>


<div>

{
<RunTimeline
 steps={run.steps}
/>
}

</div>


</div>

)

}