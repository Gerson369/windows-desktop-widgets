export function weatherDescription(code:number):string {
  if(code===0)return '晴'
  if(code<=3)return '多云'
  if(code<=48)return '雾'
  if(code<=67)return '雨'
  if(code<=77)return '雪'
  if(code<=82)return '阵雨'
  if(code<=86)return '阵雪'
  return '雷暴'
}
