import qrLoginService from '../auth/qrLogin';

export interface UserPlaylistParams {
  token?: string;
  uin?: string;
}

export default async ({ token, uin }: UserPlaylistParams) =>
  qrLoginService.getUserPlaylists(token, uin);
