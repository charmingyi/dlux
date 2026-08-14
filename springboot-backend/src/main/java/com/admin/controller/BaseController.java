package com.admin.controller;

import com.admin.service.*;
import org.springframework.beans.factory.annotation.Autowired;

public class BaseController {

    @Autowired
    UserService userService;

    @Autowired
    NodeService nodeService;

    @Autowired
    ForwardService forwardService;

    @Autowired
    ViteConfigService viteConfigService;

    @Autowired
    LinkService linkService;

    @Autowired
    LbGroupService lbGroupService;

    @Autowired
    WgNetworkService wgNetworkService;

}
