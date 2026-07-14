import { RunStep } from "@/types/run";


interface Props {

  steps: RunStep[];

}


export default function RunTimeline({
  steps
}: Props) {


  return (

    <div
      className="
      mt-4
      "
    >

      {
        steps.map((step,index)=>(

          <div
            key={index}
            className="
            flex
            items-center
            gap-3
            "
          >

            <div>
              ●
            </div>


            <div>
              {step.name}
            </div>


          </div>

        ))
      }


    </div>

  );

}